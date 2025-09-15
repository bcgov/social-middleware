import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ApplicationPackageService } from './application-package.service';
import { CreateApplicationPackageDto } from './dto/create-application-package.dto';
import { SessionAuthGuard } from 'src/auth/session-auth.guard';
import { SessionUtil } from 'src/common/utils/session.util';
import { Request } from 'express';
import { ApplicationPackage } from './schema/application-package.schema';
import { PinoLogger } from 'nestjs-pino';

@ApiBearerAuth()
@ApiTags('Application Package')
@Controller('application-package')
@UseGuards(SessionAuthGuard)
export class ApplicationPackageController {
  constructor(
    private readonly applicationPackageService: ApplicationPackageService,
    private readonly sessionUtil: SessionUtil,
    private readonly logger: PinoLogger,
  ) {}
  @Post()
  @ApiOperation({ summary: 'Create a new application package' })
  @ApiResponse({
    status: 201,
    description: 'Application package created successfully',
    type: ApplicationPackage,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - validation failed',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing session',
  })
  @ApiResponse({
    status: 500,
    description: 'Server error during application package creation',
  })
  async createApplicationPackage(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: CreateApplicationPackageDto,
    @Req() request: Request,
  ): Promise<ApplicationPackage> {
    try {
      const userId = this.sessionUtil.extractUserIdFromRequest(request);
      this.logger.info(`creating application package for ${userId}`);

      // Override userId from session (security measure)
      const createDto = { ...dto, userId };

      return await this.applicationPackageService.createApplicationPackage(
        createDto,
      );
    } catch (error) {
      this.logger.error({ error }, 'Failed to create application package');
      throw error;
    }
  }
  @Get()
  @ApiOperation({
    summary: 'Get all application packages for the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Application packages retrieved successfully',
    type: [ApplicationPackage],
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing session',
  })
  @ApiResponse({
    status: 500,
    description: 'Server error during retrieval',
  })
  async getApplicationPackages(
    @Req() request: Request,
  ): Promise<ApplicationPackage[]> {
    try {
      const userId = this.sessionUtil.extractUserIdFromRequest(request);

      this.logger.info({ userId }, 'Fetching application packages');

      return await this.applicationPackageService.getApplicationPackages(
        userId,
      );
    } catch (error) {
      this.logger.error({ error }, 'Failed to fetch application packages');
      throw error;
    }
  }
}
