import { Module } from '@nestjs/common';
import { GatewayController } from './gateway.controller.js';
import { GatewayService } from './gateway.service.js';
import { PrismaService } from '../prisma.service.js';
import { MqttModule } from '../mqtt/mqtt.module.js';

@Module({
  imports: [MqttModule],
  controllers: [GatewayController],
  providers: [GatewayService, PrismaService],
})
export class GatewayModule {}
