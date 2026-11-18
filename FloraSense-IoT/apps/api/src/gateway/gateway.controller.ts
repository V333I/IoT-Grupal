import { Body, Controller, Get, Headers, Post, UseGuards } from '@nestjs/common';
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

  @Post('sync')
  async syncFromGateway(
    @Body() body: any,
    @Headers('x-gateway-key') gatewayKey?: string,
  ) {
    return this.gatewayService.processSync(body, gatewayKey);
  }
}
