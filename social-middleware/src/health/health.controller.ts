import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  getHealth() {
    return {
      status: 'ok',
      service: process.env.APP_NAME || 'unknown',
      uptime: process.uptime().toFixed(2) + 's',
    };
  }
}
