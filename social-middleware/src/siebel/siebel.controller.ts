import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { SiebelApiService } from './siebel-api.service';
import { PinoLogger } from 'nestjs-pino';
import { GetIcmContactQueryDto } from './dto/get-icm-contact-query.dto';
import { GetServiceRequestQueryDto } from './dto/get-service-request-query.dto';

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
    name: 'SearchSpec',
    required: true,
    description: 'Siebel SearchSpec string',
    example: "([Last Name]='UL-Souers' AND [Birth Date]='05/18/1973')",
  })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: 'Comma-separated list of fields to return from Siebel',
    example:
      'M/F, Row Id, Joined AKA Last Name, Joined AKA First Name, Deceased Flag, Primary Contact Address Id, Employee Flag, Joined AKA Middle Name, Deceased Date, Last Name, Middle Name, First Name',
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
  @Get('get-service-requests')
  @ApiOperation({
    summary: 'Get Service Requests',
    description:
      'Retrieves service requests from Siebel ICM based on query parameters (Lastname + DOB via SearchSpec)',
  })
  @ApiQuery({
    name: 'SearchSpec',
    required: true,
    description: 'Siebel SearchSpec string',
    example: "([Last Name]='UL-Souers' AND [Birth Date]='05/18/1973')",
  })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: 'Comma-separated list of fields to return from Siebel',
    example: 'Row Id, Type, Subtype',
  })
  async getServiceRequests(@Query() query: GetServiceRequestQueryDto) {
    try {
      return await this.siebelApiService.getServiceRequests(query);
    } catch (error: unknown) {
      if (error instanceof Error) {
        this.logger.error(
          { error: error.message, stack: error.stack },
          'Siebel getServiceRequests failed',
        );
        throw new BadRequestException(
          error.message || 'Siebel getServiceRequests failed',
        );
      } else {
        this.logger.error({ error }, 'Siebel getServiceRequests failed');
        throw new BadRequestException(
          'Siebel getServiceRequests failed with unknown error',
        );
      }
    }
  }
}
