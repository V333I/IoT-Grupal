import { Injectable, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma.service.js';
import { RulesService } from '../mqtt/rules.service.js';

export interface GatewayNodeTelemetry {
  deviceKey: string;
  name?: string;
  groupLabel?: string;
  mac?: string;
  temperatureC?: number;
  airHumidityPct?: number;
  soilMoisturePct?: number;
  soilMoistureRaw?: number;
  pumpOn?: boolean;
  fanOn?: boolean;
  rssi?: number;
  firmwareVersion?: string;
  meshIv?: string;
  meshRsa?: string;
  meshCipher?: string;
}

export interface GatewayPacketTrace {
  id: string;
  receivedAt: string;
  gatewayId: string;
  encrypted: boolean;
  algorithm: string;
  cloudEnvelope: {
    iv: string | null;
    encryptedKey: string | null;
    payload: string | null;
    payloadBytes: number;
  };
  nodes: Array<{
    deviceKey: string;
    mac: string | null;
    meshIv: string | null;
    meshRsa: string | null;
    meshCipher: string | null;
    temperatureC: number | null;
    airHumidityPct: number | null;
    soilMoisturePct: number | null;
    pumpOn: boolean;
    fanOn: boolean;
  }>;
}

export interface GatewayAck {
  commandId: string;
  deviceKey?: string;
  status?: string;
  pumpOn?: boolean;
  fanOn?: boolean;
}

export interface GatewaySyncPayload {
  gatewayId?: string;
  sentAt?: string;
  nodes?: GatewayNodeTelemetry[];
  acks?: GatewayAck[];
}

@Injectable()
export class GatewayService {
  private readonly logger = new Logger(GatewayService.name);
  private publicKeyPem: string;
  private privateKeyPem: string;

  private lastSyncAt: Date | null = null;
  private lastGatewayId: string | null = null;
  private totalEncryptedSyncs = 0;
  private lastNodesCount = 0;
  private recentPackets: GatewayPacketTrace[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly rulesService: RulesService,
  ) {
    this.initKeys();
  }

  private initKeys() {
    if (process.env.AWS_RSA_PRIVATE_KEY && process.env.AWS_RSA_PUBLIC_KEY) {
      this.privateKeyPem = process.env.AWS_RSA_PRIVATE_KEY.replace(/\\n/g, '\n');
      this.publicKeyPem = process.env.AWS_RSA_PUBLIC_KEY.replace(/\\n/g, '\n');
      this.logger.log('Claves RSA de AWS cargadas desde variables de entorno.');
      return;
    }

    const keysDir = path.resolve(process.cwd(), 'keys');
    const privPath = path.join(keysDir, 'aws_private.pem');
    const pubPath = path.join(keysDir, 'aws_public.pem');

    if (fs.existsSync(privPath) && fs.existsSync(pubPath)) {
      this.privateKeyPem = fs.readFileSync(privPath, 'utf8');
      this.publicKeyPem = fs.readFileSync(pubPath, 'utf8');
      this.logger.log(`Claves RSA de AWS cargadas desde ${keysDir}`);
      return;
    }

    fs.mkdirSync(keysDir, { recursive: true });
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    fs.writeFileSync(privPath, privateKey, { mode: 0o600 });
    fs.writeFileSync(pubPath, publicKey);
    this.privateKeyPem = privateKey;
    this.publicKeyPem = publicKey;
    this.logger.log(`Par de claves RSA-2048 de AWS generado en ${keysDir}`);
  }

  getPublicKey() {
    return {
      algorithm: 'RSA-OAEP-SHA256 + AES-256-CBC',
      publicKeyPem: this.publicKeyPem,
    };
  }

  getStatus() {
    const isOnline =
      this.lastSyncAt !== null && Date.now() - this.lastSyncAt.getTime() < 20000;
    return {
      connected: isOnline,
      gatewayId: this.lastGatewayId,
      lastSyncAt: this.lastSyncAt ? this.lastSyncAt.toISOString() : null,
      totalEncryptedSyncs: this.totalEncryptedSyncs,
      lastNodesCount: this.lastNodesCount,
      encryption: 'RSA-OAEP (SHA-256) + AES-256-CBC',
    };
  }

  getRecentPackets(limit = 15): GatewayPacketTrace[] {
    return this.recentPackets.slice(0, Math.max(1, Math.min(20, limit)));
  }

  generateMeshRsaKeyPair(bits = 1024) {
    const modulusLength = bits === 2048 ? 2048 : 1024;
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength,
      publicExponent: 0x10001,
    });
    const jwk = privateKey.export({ format: 'jwk' }) as Record<string, string>;
    return {
      bits: modulusLength,
      n: jwk.n,
      p: jwk.p,
      q: jwk.q,
      dp: jwk.dp,
      dq: jwk.dq,
      qi: jwk.qi,
    };
  }

  validateGatewaySecret(secretHeader?: string) {
    const expected = process.env.GATEWAY_SECRET || 'change-me-gateway-secret';
    if (!secretHeader || secretHeader !== expected) {
      throw new UnauthorizedException('Gateway key inválida');
    }
  }

  private decryptEnvelope(body: any): { data: GatewaySyncPayload; encrypted: boolean } {
    if (body && body.encryptedKey && body.iv && body.payload) {
      try {
        const aesKey = crypto.privateDecrypt(
          {
            key: this.privateKeyPem,
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: 'sha256',
          },
          Buffer.from(body.encryptedKey, 'base64'),
        );

        const iv = Buffer.from(body.iv, 'base64');
        const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
        const decrypted = Buffer.concat([
          decipher.update(Buffer.from(body.payload, 'base64')),
          decipher.final(),
        ]);

        return { data: JSON.parse(decrypted.toString('utf8')), encrypted: true };
      } catch (err: any) {
        this.logger.error(`Error descifrando paquete RSA+AES-256: ${err.message}`);
        throw new BadRequestException('No se pudo descifrar el paquete RSA+AES-256');
      }
    }

    // Modo plano solo si se permite explícitamente en desarrollo
    if (process.env.ALLOW_PLAIN_GATEWAY === 'false') {
      throw new BadRequestException('Se requiere paquete cifrado RSA+AES-256');
    }
    return { data: body as GatewaySyncPayload, encrypted: false };
  }

  async processSync(body: any, gatewayKeyHeader?: string) {
    this.validateGatewaySecret(gatewayKeyHeader);

    const { data, encrypted } = this.decryptEnvelope(body);
    const nodes = Array.isArray(data.nodes) ? data.nodes : [];
    const acks = Array.isArray(data.acks) ? data.acks : [];

    this.lastSyncAt = new Date();
    this.lastGatewayId = data.gatewayId || 'rpi5-gateway';
    this.lastNodesCount = nodes.length;
    if (encrypted) {
      this.totalEncryptedSyncs += 1;
    }

    const packetTrace: GatewayPacketTrace = {
      id: crypto.randomUUID(),
      receivedAt: this.lastSyncAt.toISOString(),
      gatewayId: this.lastGatewayId,
      encrypted,
      algorithm: encrypted ? 'RSA-OAEP (SHA-256) + AES-256-CBC' : 'PLAIN',
      cloudEnvelope: {
        iv: typeof body?.iv === 'string' ? body.iv : null,
        encryptedKey: typeof body?.encryptedKey === 'string' ? body.encryptedKey : null,
        payload: typeof body?.payload === 'string' ? body.payload : null,
        payloadBytes:
          typeof body?.payload === 'string'
            ? Buffer.from(body.payload, 'base64').length
            : Buffer.byteLength(JSON.stringify(body ?? {}), 'utf8'),
      },
      nodes: nodes.map((n) => ({
        deviceKey: String(n.deviceKey || 'DESCONOCIDO'),
        mac: n.mac ? String(n.mac).toUpperCase() : null,
        meshIv: n.meshIv ? String(n.meshIv) : null,
        meshRsa: n.meshRsa ? String(n.meshRsa) : null,
        meshCipher: n.meshCipher ? String(n.meshCipher) : null,
        temperatureC: n.temperatureC ?? null,
        airHumidityPct: n.airHumidityPct ?? null,
        soilMoisturePct: n.soilMoisturePct ?? null,
        pumpOn: Boolean(n.pumpOn),
        fanOn: Boolean(n.fanOn),
      })),
    };
    this.recentPackets.unshift(packetTrace);
    if (this.recentPackets.length > 20) {
      this.recentPackets.length = 20;
    }

    // 1. Procesar ACKs de comandos ejecutados en la red Mesh
    for (const ack of acks) {
      if (!ack.commandId) continue;
      await this.prisma.pumpCommand
        .updateMany({
          where: { id: ack.commandId },
          data: {
            status: ack.status || 'ACKNOWLEDGED',
            acknowledgedAt: new Date(),
          },
        })
        .catch(() => null);

      if (ack.pumpOn === false) {
        const evt = await this.prisma.irrigationEvent
          .findUnique({ where: { id: ack.commandId } })
          .catch(() => null);
        if (evt && !evt.stoppedAt) {
          const duration = Math.round((Date.now() - evt.startedAt.getTime()) / 1000);
          await this.prisma.irrigationEvent.update({
            where: { id: ack.commandId },
            data: {
              stoppedAt: new Date(),
              durationSeconds: duration,
              stopReason: 'GATEWAY_ACK_OFF',
            },
          });
        }
      }
    }

    // 2. Procesar telemetría de cada grupo/nodo
    const syncedDeviceIds: string[] = [];
    for (const node of nodes) {
      if (!node.deviceKey) continue;

      let device = await this.prisma.device.findUnique({
        where: { deviceKey: node.deviceKey },
      });

      if (!device) {
        device = await this.prisma.device.create({
          data: {
            deviceKey: node.deviceKey,
            name: node.name || node.deviceKey,
            locationLabel: node.groupLabel || node.deviceKey,
            description: node.mac ? `Nodo ESP8266 MAC ${node.mac}` : 'Nodo Mesh Canal 6',
            status: 'ONLINE',
            mode: 'AUTO',
            lastSeenAt: new Date(),
            firmwareVersion: node.firmwareVersion || 'esp8266-mesh-c6',
          },
        });

        await this.prisma.irrigationRule.create({
          data: {
            deviceId: device.id,
            enabled: true,
            startBelowPct: 40.0,
            stopAbovePct: 70.0,
            maxRuntimeSeconds: 30,
            cooldownSeconds: 60,
          },
        });
      } else {
        device = await this.prisma.device.update({
          where: { id: device.id },
          data: {
            status: 'ONLINE',
            lastSeenAt: new Date(),
            ...(node.name ? { name: node.name } : {}),
            ...(node.groupLabel ? { locationLabel: node.groupLabel } : {}),
            ...(node.mac ? { description: `Nodo ESP8266 MAC ${node.mac}` } : {}),
            ...(node.firmwareVersion ? { firmwareVersion: node.firmwareVersion } : {}),
          },
        });
      }

      syncedDeviceIds.push(device.id);

      await this.prisma.telemetry.create({
        data: {
          deviceId: device.id,
          temperatureC: node.temperatureC ?? null,
          airHumidityPct: node.airHumidityPct ?? null,
          soilMoistureRaw: node.soilMoistureRaw ?? null,
          soilMoisturePct: node.soilMoisturePct ?? null,
          pumpOn: Boolean(node.pumpOn),
          fanOn: Boolean(node.fanOn),
          rssi: node.rssi ?? null,
          payloadVersion: 1,
        },
      });

      // Mantener sincronizado el estado de IrrigationEvent según estado real de bomba
      if (node.pumpOn) {
        const openEvent = await this.prisma.irrigationEvent.findFirst({
          where: { deviceId: device.id, stoppedAt: null },
        });
        if (!openEvent) {
          await this.prisma.irrigationEvent.create({
            data: {
              deviceId: device.id,
              origin: 'LOCAL_AUTO',
              triggeredBy: `Nodo ${device.name}`,
            },
          });
        }
      } else {
        const openEvents = await this.prisma.irrigationEvent.findMany({
          where: { deviceId: device.id, stoppedAt: null },
        });
        for (const evt of openEvents) {
          const duration = Math.round((Date.now() - evt.startedAt.getTime()) / 1000);
          await this.prisma.irrigationEvent.update({
            where: { id: evt.id },
            data: {
              stoppedAt: new Date(),
              durationSeconds: duration,
              stopReason: 'TELEMETRY_REPORTED_OFF',
            },
          });
        }
      }

      if (device.mode === 'AUTO' && node.soilMoisturePct !== undefined) {
        await this.rulesService.evaluateRules(device.id, node.soilMoisturePct);
      }
    }

    // 3. Expirar comandos PENDING/SENT viejos (>2 min) para no acumular pendientes huerfanos
    await this.prisma.pumpCommand.updateMany({
      where: {
        status: { in: ['PENDING', 'SENT'] },
        requestedAt: { lt: new Date(Date.now() - 2 * 60 * 1000) },
      },
      data: { status: 'EXPIRED' },
    });

    // 4. Obtener comandos PENDING para devolverlos en el canal bidireccional a la RPi 5
    const pendingCommands = await this.prisma.pumpCommand.findMany({
      where: {
        status: 'PENDING',
        ...(syncedDeviceIds.length > 0 ? { deviceId: { in: syncedDeviceIds } } : {}),
      },
      include: {
        device: {
          select: { deviceKey: true, name: true },
        },
      },
      orderBy: { requestedAt: 'asc' },
    });

    if (pendingCommands.length > 0) {
      await this.prisma.pumpCommand.updateMany({
        where: { id: { in: pendingCommands.map((c) => c.id) } },
        data: { status: 'SENT' },
      });
    }

    this.logger.log(
      `[GATEWAY SYNC] ${this.lastGatewayId} | cifrado=${encrypted ? 'RSA+AES256' : 'PLAIN'} | nodos=${nodes.length} | acks=${acks.length} | cmds=${pendingCommands.length}`,
    );

    return {
      ok: true,
      encrypted,
      serverTime: new Date().toISOString(),
      processedNodes: nodes.length,
      processedAcks: acks.length,
      commands: pendingCommands.map((cmd) => ({
        commandId: cmd.id,
        deviceId: cmd.deviceId,
        deviceKey: cmd.device.deviceKey,
        deviceName: cmd.device.name,
        target: cmd.target,
        action: cmd.action,
        maxDurationSeconds: cmd.durationSeconds ?? 30,
        issuedAt: cmd.requestedAt.toISOString(),
      })),
    };
  }
}
