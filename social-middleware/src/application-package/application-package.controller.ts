import {
  Controller,
  Get,
  Delete,
  Post,
  Body,
  UseGuards,
  Req,
  ValidationPipe,
  HttpCode,
  Param,
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
import { ApplicationForm } from '../application-form/schemas/application-form.schema';
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

      return await this.applicationPackageService.createApplicationPackage(
        dto,
        userId,
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
  @Get(':applicationPackageId/application-form')
  @ApiOperation({ summary: 'Get all application forms for a package' })
  @ApiResponse({
    status: 200,
    description: 'Application forms retrieved successfully',
    type: [ApplicationForm],
  })
  async getApplicationForms(
    @Param('applicationPackageId') applicationPackageId: string,
    @Req() request: Request,
  ): Promise<ApplicationForm[]> {
    const userId = this.sessionUtil.extractUserIdFromRequest(request);

    return await this.applicationPackageService.getApplicationFormsByPackageId(
      applicationPackageId,
      userId,
    );
  }

  @Delete(':applicationPackageId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Cancel/delete an application package' })
  @ApiResponse({
    status: 204,
    description: 'Application package cancelled successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Application package not found or access denied',
  })
  @ApiResponse({
    status: 500,
    description: 'Server error during cancellation',
  })
  async cancelApplicationPackage(
    @Param('applicationPackageId') applicationPackageId: string,
    @Req() request: Request,
  ): Promise<void> {
    const userId = this.sessionUtil.extractUserIdFromRequest(request);

    const cancelDto = {
      userId,
      applicationPackageId,
    };

    await this.applicationPackageService.cancelApplicationPackage(cancelDto);
  }

  @Post(':applicationPackageId/submit')
  @ApiOperation({ summary: 'Submit application package to Siebel' })
  @ApiResponse({
    status: 200,
    description: 'Application package submitted successfully',
    schema: {
      type: 'object',
      properties: {
        serviceRequestId: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Application package not found or already submitted',
  })
  @ApiResponse({
    status: 500,
    description: 'Server error during submission',
  })
  async submitApplicationPackage(
    @Param('applicationPackageId') applicationPackageId: string,
    @Req() request: Request,
  ): Promise<{ serviceRequestId: string }> {
    try {
      const userId = this.sessionUtil.extractUserIdFromRequest(request);

      this.logger.info(
        { applicationPackageId, userId },
        'Submitting application package to Siebel',
      );

      return await this.applicationPackageService.submitApplicationPackage(
        applicationPackageId,
        userId,
      );
    } catch (error) {
      this.logger.error(
        { error, applicationPackageId },
        'Failed to submit application package',
      );
      throw error;
    }
  }
}
