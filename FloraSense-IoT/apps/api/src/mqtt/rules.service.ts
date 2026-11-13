import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import * as mqtt from 'mqtt';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class RulesService {
  private readonly logger = new Logger(RulesService.name);
  private mqttClient: mqtt.MqttClient;

  constructor(private prisma: PrismaService) {}

  setMqttClient(client: mqtt.MqttClient) {
    this.mqttClient = client;
  }

  getMqttStatus() {
    return this.mqttClient ? this.mqttClient.connected : false;
  }

  async evaluateRules(deviceId: string, currentMoisturePct: number) {
    if (currentMoisturePct === null || currentMoisturePct === undefined) return;

    const rules = await this.prisma.irrigationRule.findMany({
      where: { deviceId, enabled: true },
    });

    if (rules.length === 0) return;

    const rule = rules[0];

    // No disparar otra regla si ya hay un comando pendiente/en vuelo o un riego activo
    const activeCommand = await this.prisma.pumpCommand.findFirst({
      where: {
        deviceId,
        target: 'pump',
        action: 'ON',
        status: { in: ['PENDING', 'SENT'] },
        requestedAt: { gte: new Date(Date.now() - Math.max(rule.maxRuntimeSeconds, 60) * 1000) },
      },
    });
    if (activeCommand) return;

    const openEvent = await this.prisma.irrigationEvent.findFirst({
      where: { deviceId, stoppedAt: null },
    });
    if (openEvent) {
      if (currentMoisturePct >= rule.stopAbovePct) {
        const pendingStop = await this.prisma.pumpCommand.findFirst({
          where: {
            deviceId,
            target: 'pump',
            action: 'OFF',
            status: { in: ['PENDING', 'SENT'] },
            requestedAt: { gte: new Date(Date.now() - 30 * 1000) },
          },
        });
        if (!pendingStop) {
          this.logger.log(`Humedad ${currentMoisturePct}% >= umbral parada ${rule.stopAbovePct}%. Deteniendo riego.`);
          await this.stopPump(deviceId, 'AUTO_RULE');
        }
      }
      return;
    }

    // Verificar cooldown desde el último evento
    const lastEvent = await this.prisma.irrigationEvent.findFirst({
      where: { deviceId },
      orderBy: { startedAt: 'desc' },
    });

    if (lastEvent) {
      const secondsSinceLastRiego = (Date.now() - lastEvent.startedAt.getTime()) / 1000;
      if (secondsSinceLastRiego < rule.cooldownSeconds) {
        return;
      }
    }

    if (currentMoisturePct <= rule.startBelowPct) {
      this.logger.log(`Humedad ${currentMoisturePct}% <= umbral ${rule.startBelowPct}%. Activando riego.`);
      await this.triggerPump(deviceId, rule.maxRuntimeSeconds, 'AUTO_RULE');
    }
  }

  async triggerFan(deviceId: string, action: string, origin: string, triggeredBy: string = 'Admin') {
    const commandId = uuidv4();
    const normalizedAction = action.toUpperCase();

    await this.prisma.pumpCommand.create({
      data: {
        id: commandId,
        deviceId,
        origin,
        target: 'fan',
        action: normalizedAction,
        status: 'PENDING',
      },
    });

    await this.prisma.irrigationEvent.create({
      data: {
        id: commandId,
        deviceId,
        commandId,
        origin,
        triggeredBy: `${triggeredBy} (Ventilador)`,
        startedAt: new Date(),
        stoppedAt: normalizedAction === 'OFF' ? new Date() : null,
        stopReason: normalizedAction === 'OFF' ? 'MANUAL' : null,
      },
    });

    if (this.mqttClient?.connected) {
      const topic = `iot/v1/devices/${deviceId}/commands`;
      this.mqttClient.publish(
        topic,
        JSON.stringify({ commandId, action: normalizedAction.toLowerCase(), target: 'fan' }),
      );
    }

    this.logger.log(`Comando FAN ${normalizedAction} encolado (${commandId}) para ${deviceId}`);
  }

  async triggerPump(deviceId: string, durationSeconds: number, origin: string, triggeredBy: string = 'Sistema Automático') {
    const commandId = uuidv4();

    await this.prisma.pumpCommand.create({
      data: {
        id: commandId,
        deviceId,
        origin,
        target: 'pump',
        action: 'ON',
        durationSeconds,
        status: 'PENDING',
      },
    });

    await this.prisma.irrigationEvent.create({
      data: {
        id: commandId,
        deviceId,
        commandId,
        origin,
        triggeredBy,
      },
    });

    if (this.mqttClient?.connected) {
      const payload = {
        version: 1,
        commandId,
        action: 'ON',
        target: 'pump',
        maxDurationSeconds: durationSeconds,
        issuedAt: new Date().toISOString(),
      };
      const topic = `iot/v1/devices/${deviceId}/commands`;
      this.mqttClient.publish(topic, JSON.stringify(payload), { qos: 1 });
      this.logger.log(`Comando ON enviado al topic ${topic}`);
    } else {
      this.logger.log(`Comando ON encolado para Gateway (${commandId}) -> ${deviceId}`);
    }
  }

  async stopPump(deviceId: string, origin: string) {
    const commandId = uuidv4();

    await this.prisma.pumpCommand.create({
      data: {
        id: commandId,
        deviceId,
        origin,
        target: 'pump',
        action: 'OFF',
        status: 'PENDING',
      },
    });

    if (this.mqttClient?.connected) {
      const payload = {
        version: 1,
        commandId,
        action: 'OFF',
        target: 'pump',
        issuedAt: new Date().toISOString(),
      };
      const topic = `iot/v1/devices/${deviceId}/commands`;
      this.mqttClient.publish(topic, JSON.stringify(payload), { qos: 1 });
      this.logger.log(`Comando OFF enviado al topic ${topic}`);
    } else {
      this.logger.log(`Comando OFF encolado para Gateway (${commandId}) -> ${deviceId}`);
    }
  }
}
