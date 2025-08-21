import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { SiebelApiService } from './siebel-api.service';
import { PinoLogger } from 'nestjs-pino';
import { GetIcmContactQueryDto } from './dto/get-icm-contact-query.dto';

@ApiTags('Siebel Integration')
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

  @Get('get-icm-contact')
  @ApiOperation({
    summary: 'Get ICM Contact Information',
    description:
      'Retrieves contact data from Siebel ICM based on query parameters',
  })
  @ApiQuery({
    name: 'lastName',
    required: true,
    description: 'the Last Name of the user to filter by',
    example: 'JOHNSON',
  })
  async getICMContact(@Query() query: GetIcmContactQueryDto) {
    try {
      return await this.siebelApiService.getCaseContacts(query);
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
