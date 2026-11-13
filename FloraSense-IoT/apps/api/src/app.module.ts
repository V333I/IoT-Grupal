import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaService } from './prisma.service.js';
import { MqttModule } from './mqtt/mqtt.module.js';
import { AuthModule } from './auth/auth.module.js';
import { GatewayModule } from './gateway/gateway.module.js';

@Module({
  imports: [MqttModule, AuthModule, GatewayModule],
  controllers: [AppController],
  providers: [AppService, PrismaService],
})
export class AppModule {}
