import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { SiebelApiService } from './siebel-api.service';
import { PinoLogger } from 'nestjs-pino';

@Controller('siebel')
export class SiebelController {
  constructor(
    private readonly siebelApiService: SiebelApiService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SiebelController.name);
  }

  @Get('test')
  async testConnection() {
    try {
      // Replace with actual Siebel endpoint
      const result = await this.siebelApiService.get('/some-test-endpoint');
      this.logger.info({ result }, 'Siebel test connection successful');
      return { success: true, data: result };
    } catch (error: unknown) {
      if (error instanceof Error) {
        this.logger.error(
          { error: error.message, stack: error.stack },
          'Siebel test connection failed',
        );
        throw new BadRequestException(error.message || 'Siebel test failed');
      } else {
        this.logger.error({ error }, 'Siebel test connection failed');
        throw new BadRequestException('Siebel test failed with unknown error');
      }
    }
  }

  @Get(':endpoint')
  async getData(@Param('endpoint') endpoint: string, @Query() query: any) {
    try {
      return await this.siebelApiService.get(`/${endpoint}`, query);
    } catch (error: unknown) {
      if (error instanceof Error) {
        this.logger.error(
          { error: error.message, stack: error.stack },
          'Siebel test connection failed',
        );
        throw new BadRequestException(error.message || 'Siebel test failed');
      } else {
        this.logger.error({ error }, 'Siebel test connection failed');
        throw new BadRequestException('Siebel test failed with unknown error');
      }
    }
  }
}
