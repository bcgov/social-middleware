import { Controller, Get } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { getConfig } from '../common/config/config-loader';

@Controller('health')
export class HealthController {
  constructor(private readonly logger: PinoLogger) {}
  @Get()
  getHealth() {
    this.logger.info('Health check endpoint hit');
    const config = getConfig();

    return {
      status: 'ok',
      service: config.get<string>('APP_NAME') || 'unknown',
      uptime: process.uptime().toFixed(2) + 's',
    };
  }
}
