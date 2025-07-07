import { Controller, Get } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

@Controller('health')
export class HealthController {
  constructor(private readonly logger: PinoLogger) { }
  @Get()
  getHealth() {
    this.logger.info('Health check endpoint hit');

    return {
      status: 'ok',
      service: process.env.APP_NAME || 'unknown',
      uptime: process.uptime().toFixed(2) + 's',
    };
  }
}
