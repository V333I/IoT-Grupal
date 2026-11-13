import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { GatewayService } from './gateway.service.js';

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

  @Post('sync')
  async syncFromGateway(
    @Body() body: any,
    @Headers('x-gateway-key') gatewayKey?: string,
  ) {
    return this.gatewayService.processSync(body, gatewayKey);
  }
}
