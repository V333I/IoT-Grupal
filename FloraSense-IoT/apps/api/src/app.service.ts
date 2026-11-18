import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { RulesService } from './mqtt/rules.service.js';

@Injectable()
export class AppService {
  constructor(
    private prisma: PrismaService,
    private rulesService: RulesService,
  ) {}

  async getHello(): Promise<any> {
    const deviceCount = await this.prisma.device.count();
    return {
      message: 'Hello World from IoT API!',
      status: 'online',
      database: { devicesRegistered: deviceCount },
    };
  }

  async getAllDevices() {
    return this.prisma.device.findMany({
      orderBy: [{ deviceKey: 'asc' }, { name: 'asc' }],
    });
  }

  async getDevicesOverview() {
    const devices = await this.prisma.device.findMany({
      orderBy: [{ deviceKey: 'asc' }, { name: 'asc' }],
    });

    const now = Date.now();
    const overview = await Promise.all(
      devices.map(async (device) => {
        const [lastTelemetry, lastEvent, rule, pendingCommands] = await Promise.all([
          this.prisma.telemetry.findFirst({
            where: { deviceId: device.id },
            orderBy: { recordedAt: 'desc' },
          }),
          this.prisma.irrigationEvent.findFirst({
            where: { deviceId: device.id },
            orderBy: { startedAt: 'desc' },
          }),
          this.prisma.irrigationRule.findFirst({
            where: { deviceId: device.id },
          }),
          this.prisma.pumpCommand.count({
            where: { deviceId: device.id, status: { in: ['PENDING', 'SENT'] } },
          }),
        ]);

        const isOnline =
          device.lastSeenAt !== null && now - device.lastSeenAt.getTime() < 30000;

        const macMatch = device.description?.match(/([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}/);

        return {
          id: device.id,
          deviceKey: device.deviceKey,
          name: device.name,
          locationLabel: device.locationLabel,
          description: device.description,
          mac: macMatch ? macMatch[0].toUpperCase() : null,
          status: isOnline ? 'ONLINE' : 'OFFLINE',
          mode: device.mode,
          lastSeenAt: device.lastSeenAt,
          firmwareVersion: device.firmwareVersion,
          pendingCommands,
          lastTelemetry: lastTelemetry
            ? {
                ...lastTelemetry,
                timestamp: lastTelemetry.recordedAt,
                id: lastTelemetry.id.toString(),
              }
            : null,
          lastEvent,
          rule,
        };
      }),
    );

    overview.sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === 'ONLINE' ? -1 : 1;
      }
      return a.deviceKey.localeCompare(b.deviceKey);
    });

    return overview;
  }

  async deleteDevice(id: string) {
    return this.prisma.device.delete({ where: { id } });
  }

  async createDevice(name: string) {
    const crypto = await import('crypto');
    const id = crypto.randomUUID();
    return this.prisma.device.create({
      data: {
        id,
        deviceKey: `key-${id}`,
        name: name || 'Nuevo Dispositivo ESP32',
        status: 'OFFLINE',
      },
    });
  }

  async updateDeviceMode(id: string, mode: string) {
    const device = await this.prisma.device.findUnique({ where: { id } });
    if (!device) throw new NotFoundException('Device not found');
    return this.prisma.device.update({
      where: { id },
      data: { mode },
    });
  }

  async getMqttStatus() {
    return {
      connected: this.rulesService.getMqttStatus(),
    };
  }

  async getDemoDevice(requestedId?: string): Promise<any> {
    const device = requestedId
      ? await this.prisma.device.findUnique({ where: { id: requestedId } })
      : await this.prisma.device.findFirst({ orderBy: { lastSeenAt: 'desc' } });

    if (!device) return null;

    const lastTelemetry = await this.prisma.telemetry.findFirst({
      where: { deviceId: device.id },
      orderBy: { recordedAt: 'desc' },
    });

    const isOnline =
      device.lastSeenAt !== null && Date.now() - device.lastSeenAt.getTime() < 30000;

    return {
      id: device.id,
      deviceKey: device.deviceKey,
      name: device.name,
      mode: device.mode,
      status: isOnline ? 'ONLINE' : 'OFFLINE',
      lastTelemetry: lastTelemetry
        ? {
            ...lastTelemetry,
            timestamp: lastTelemetry.recordedAt,
            id: lastTelemetry.id.toString(),
          }
        : null,
    };
  }

  async sendPumpCommand(deviceId: string, action: string, durationSeconds: number, userName: string) {
    const device = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) throw new NotFoundException('Device not found');

    if (action === 'ON') {
      await this.rulesService.triggerPump(deviceId, durationSeconds, 'MANUAL', userName);
    } else {
      await this.rulesService.stopPump(deviceId, 'MANUAL');
    }

    return { success: true, action, deviceId };
  }

  async sendFanCommand(deviceId: string, action: string, userName: string) {
    const device = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) throw new NotFoundException('Device not found');

    await this.rulesService.triggerFan(deviceId, action, 'MANUAL', userName);
    return { success: true, action, deviceId };
  }

  async getDeviceRule(deviceId: string) {
    const rules = await this.prisma.irrigationRule.findMany({
      where: { deviceId },
    });
    if (rules.length === 0) throw new NotFoundException('No rules found');
    return rules[0];
  }

  async updateDeviceRule(ruleId: string, data: any) {
    return this.prisma.irrigationRule.update({
      where: { id: ruleId },
      data: {
        ...(data.enabled !== undefined ? { enabled: Boolean(data.enabled) } : {}),
        startBelowPct: data.startBelowPct,
        stopAbovePct: data.stopAbovePct,
        maxRuntimeSeconds: data.maxRuntimeSeconds,
        cooldownSeconds: data.cooldownSeconds,
      },
    });
  }

  async getDeviceEvents(deviceId: string) {
    return this.prisma.irrigationEvent.findMany({
      where: { deviceId },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
  }

  async getDeviceTelemetry(deviceId: string) {
    const data = await this.prisma.telemetry.findMany({
      where: { deviceId },
      orderBy: { recordedAt: 'desc' },
      take: 100,
    });
    return data.reverse().map((t) => ({
      ...t,
      id: t.id.toString(),
    }));
  }
}
