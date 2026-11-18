import { Body, Controller, Get, Headers, Post, Query, UseGuards } from '@nestjs/common';
import { GatewayService } from './gateway.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

@Controller('api/gateway')
export class GatewayController {
  constructor(private readonly gatewayService: GatewayService) {}

  @Get('public-key')
  getPublicKey() {
    return this.gatewayService.getPublicKey();
  }

  @Get('status')
  getStatus() {
    return this.gatewayService.getStatus();
  }

  @UseGuards(JwtAuthGuard)
  @Get('packets')
  getRecentPackets() {
    return this.gatewayService.getRecentPackets(15);
  }

  @UseGuards(JwtAuthGuard)
  @Get('generate-rsa')
  generateMeshRsa(@Query('bits') bits?: string) {
    const parsed = Number(bits) === 2048 ? 2048 : 1024;
    return this.gatewayService.generateMeshRsaKeyPair(parsed);
  }

  @Post('sync')
  async syncFromGateway(
    @Body() body: any,
    @Headers('x-gateway-key') gatewayKey?: string,
  ) {
    return this.gatewayService.processSync(body, gatewayKey);
  }
}
