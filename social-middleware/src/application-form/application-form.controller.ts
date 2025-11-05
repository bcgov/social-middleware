/* eslint-disable prettier/prettier */
import {
  Controller,
  Query,
  Req,
  Get,
  Param,
  UseGuards,
  Body,
  ValidationPipe,
  NotFoundException,
  UnauthorizedException,
  Post,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Request } from 'express';
import { NewTokenDto } from './dto/new-token.dto';
import { GetApplicationFormDto } from './dto/get-application-form.dto';
import { SubmitApplicationFormDto } from './dto/submit-application-form.dto';
//import { InviteHouseholdMemberParamsDto } from './dto/invite-household-member-params.dto';
import { SessionAuthGuard } from 'src/auth/session-auth.guard';
import { ApplicationFormService } from './services/application-form.service';
import { ApplicationFormType } from './enums/application-form-types.enum';
import { SessionUtil } from 'src/common/utils/session.util';
import { PinoLogger } from 'nestjs-pino';
import { ApplicationFormStatus } from './enums/application-form-status.enum';

@ApiBearerAuth()
@ApiTags('Application Forms')
@Controller('application-forms')
export class ApplicationFormsController {
  constructor(
    private readonly applicationFormsService: ApplicationFormService,
    private readonly sessionUtil: SessionUtil,
    private readonly logger: PinoLogger,
  ) {}

  @Get('token')
  @UseGuards(SessionAuthGuard)
  @ApiOperation({ summary: 'Get form access token by application ID' })
  @ApiQuery({
    name: 'applicationFormId',
    required: true,
    description: 'The application ID to get the form access token for',
  })
  @ApiResponse({
    status: 200,
    description: 'Form access token retrieved successfully',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing session',
  })
  @ApiResponse({
    status: 404,
    description: 'No form parameters found for the given application ID',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error',
  })
  async getFormAccessToken(
    @Query('applicationFormId') applicationFormId: string,
    @Req() request: Request,
  ): Promise<{ formAccessToken: string }> {
    const userId = this.sessionUtil.extractUserIdFromRequest(request);

    const dto: NewTokenDto = {
      applicationFormId,
    };

    const ownsForm = await this.applicationFormsService.confirmOwnership(
      applicationFormId,
      userId,
    );

    if (ownsForm) {
      const formAccessToken =
        await this.applicationFormsService.newFormAccessToken(dto);
      return { formAccessToken };
    } else {
      throw new UnauthorizedException(
        'Invalid applicationForm or unauthorized access',
      );
    }
  }

  @Get(':applicationFormId')
  @UseGuards(SessionAuthGuard)
  @ApiOperation({ summary: 'Get application form metadata by application ID' })
  @ApiParam({
    name: 'applicationFormId',
    required: true,
    description: 'The application ID to retrieve',
  })
  @ApiResponse({
    status: 200,
    description: 'Application form metadata retrieved successfully',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing session',
  })
  @ApiResponse({
    status: 404,
    description: 'Application form not found or access denied',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error',
  })
  async getApplicationFormById(
    @Param('applicationFormId') applicationFormId: string,
    @Req() request: Request,
  ): Promise<GetApplicationFormDto> {
    const userId = this.sessionUtil.extractUserIdFromRequest(request);

    const applicationForm =
      await this.applicationFormsService.getApplicationFormById(
        applicationFormId,
        userId,
      );

    if (!applicationForm) {
      throw new NotFoundException(
        'Application form not found or access denied',
      );
    }

    return applicationForm;
  }
  /*
  @Post(':applicationId/household/:householdMemberId/invite')
  @ApiOperation({
    summary: 'Generate an access code for a household member screening',
  })
  @ApiResponse({
    status: 201,
    description: 'Access code generated successfully',
    schema: {
      type: 'object',
      properties: {
        accessCode: { type: 'string' },
        screeningApplicationid: { type: 'string' },
        expiresAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  async inviteHouseholdMember(
    @Param(new ValidationPipe({ whitelist: true, transform: true }))
    params: InviteHouseholdMemberParamsDto,
  ) {
    return await this.applicationFormService.createHouseholdScreening(
      params.applicationId,
      params.householdMemberId,
    );
  }
*/
  @Post('submit')
  @ApiOperation({
    summary: 'Update application form data with Completed Status',
  })
  @ApiResponse({
    status: 200,
    description: 'Application Form data successfully updated',
  })
  @ApiResponse({ status: 404, description: 'Token or application not found' })
  @ApiResponse({
    status: 500,
    description: 'Server error during application form submission',
  })
  async submitApplicationForm(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: SubmitApplicationFormDto,
  ) {
    return await this.applicationFormsService.submitApplicationForm(
      dto,
      ApplicationFormStatus.COMPLETE
    );
  }

  @Get()
  @ApiOperation({
    summary: 'Get user application forms',
    description:
      'Retrieves application forms assigned to the authenticated user (screening forms)',
  })
  @ApiResponse({
    status: 200,
    description: 'Application forms retrieved successfully',
    type: [GetApplicationFormDto],
  })
  async getUserApplicationForms(
    @Req() request: Request,
  ): Promise<GetApplicationFormDto[]> {
    const userId = this.sessionUtil.extractUserIdFromRequest(request);

    // Hard-coded to only return screening forms
    return await this.applicationFormsService.getApplicationFormsByUser(
      userId,
      [ApplicationFormType.SCREENING],
    );
  }

  @Post('saveDraft')
  @ApiOperation({ summary: 'Update application form data with Draft status' })
  @ApiResponse({
    status: 200,
    description: 'Application Form data successfully updated',
  })
  @ApiResponse({ status: 404, description: 'Token or application not found' })
  @ApiResponse({
    status: 500,
    description: 'Server error during application form submission',
  })
  async saveDraftApplicationForm(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: SubmitApplicationFormDto,
  ) {
    return await this.applicationFormsService.submitApplicationForm(
      dto,
      ApplicationFormStatus.DRAFT
    );
  }
}
