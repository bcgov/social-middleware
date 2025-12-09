import {
  Controller,
  Get,
  Delete,
  Post,
  Patch,
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
import { ApplicationPackageStatus } from './enums/application-package-status.enum';
import { SubmitReferralRequestDto } from './dto/submit-referral-request.dto';
import { CreateApplicationPackageDto } from './dto/create-application-package.dto';
import { UpdateApplicationPackageDto } from './dto/update-application-package.dto';
import { ValidateHouseholdCompletionDto } from './dto/validate-application-package.dto';
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
  @Patch(':applicationPackageId')
  @ApiOperation({
    summary: 'Update the status elements of an application package',
  })
  @ApiResponse({
    status: 200,
    description: 'Application package status updated successfully',
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
    status: 404,
    description: 'Application package not found',
  })
  @ApiResponse({
    status: 500,
    description: 'Server error during application package update',
  })
  async updateApplicationPackage(
    @Param('applicationPackageId') applicationPackageId: string,
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: UpdateApplicationPackageDto,
    @Req() request: Request,
  ): Promise<ApplicationPackage> {
    try {
      const userId = this.sessionUtil.extractUserIdFromRequest(request);
      this.logger.info(`patching application package for ${userId}`);

      return await this.applicationPackageService.updateApplicationPackage(
        applicationPackageId,
        dto,
        userId,
      );
    } catch (error) {
      this.logger.error({ error }, 'Failed to update application package');
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
  @Get(':applicationPackageId')
  @ApiOperation({
    summary: 'Get application package by ID for the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Application package retrieved successfully',
    type: ApplicationPackage,
  })
  @ApiResponse({
    status: 404,
    description: 'Application package not found or access denied',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing session',
  })
  async getApplicationPackage(
    @Param('applicationPackageId') applicationPackageId: string,
    @Req() request: Request,
  ): Promise<ApplicationPackage> {
    try {
      const userId = this.sessionUtil.extractUserIdFromRequest(request);

      this.logger.info(
        { applicationPackageId, userId },
        'Fetching application package',
      );

      return await this.applicationPackageService.getApplicationPackage(
        applicationPackageId,
        userId,
      );
    } catch (error) {
      this.logger.error(
        { error, applicationPackageId },
        'Failed to fetch application package',
      );
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
  @Get(':applicationPackageId/validate-household')
  @UseGuards(SessionAuthGuard)
  @ApiOperation({
    summary: 'Validate household completion for an application package',
  })
  @ApiResponse({
    status: 200,
    description: 'Household validation results',
    type: ValidateHouseholdCompletionDto,
  })
  @ApiResponse({ status: 404, description: 'Application package not found' })
  async validateHouseholdCompletion(
    @Param('applicationPackageId') applicationPackageId: string,
    @Req() req: Request,
  ): Promise<ValidateHouseholdCompletionDto> {
    const userId = this.sessionUtil.extractUserIdFromRequest(req);
    return await this.applicationPackageService.validateHouseholdCompletion(
      applicationPackageId,
      userId,
    );
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

  @Post(':applicationPackageId/request-info-session')
  @ApiOperation({ summary: 'Request a Caregiver Information Session' })
  @ApiResponse({
    status: 200,
    description: 'Information Session successfully requested',
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
  async submitReferralRequest(
    @Param('applicationPackageId') applicationPackageId: string,
    @Body() dto: SubmitReferralRequestDto,
    @Req() request: Request,
  ): Promise<{ serviceRequestId: string }> {
    try {
      const userId = this.sessionUtil.extractUserIdFromRequest(request);

      this.logger.info(
        { applicationPackageId, userId },
        'Submitting Infomation Session Request to Siebel',
      );

      return await this.applicationPackageService.submitReferralRequest(
        applicationPackageId,
        userId,
        dto,
      );
    } catch (error) {
      this.logger.error(
        { error, applicationPackageId },
        'Failed to request information session',
      );
      throw error;
    }
  }

  @Post(':applicationPackageId/lock-application')
  @ApiOperation({
    summary:
      'Lock application for household completion and application submission',
  })
  @ApiResponse({
    status: 200,
    description: 'ApplicationStatus updated',
    schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: Object.values(ApplicationPackageStatus),
        },
        //requiresHouseholdScreening: { type: 'boolean' },
        //message: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Incomplete data in application package, likely household data',
  })
  @ApiResponse({ status: 404, description: 'Application package not found' })
  async validateAndProcessApplication(
    @Param('applicationPackageId') applicationPackageId: string,
    @Req() req: Request,
  ): Promise<{
    status: ApplicationPackageStatus;
    //requiresHouseholdScreening: boolean;
    //message: string; //TODO: we could pass some errors to the front end at some point
  }> {
    const userId = this.sessionUtil.extractUserIdFromRequest(req);
    return await this.applicationPackageService.lockApplicationPackage(
      applicationPackageId,
      userId,
    );
  }
}
