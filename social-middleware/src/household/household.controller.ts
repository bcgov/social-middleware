import {
  Controller,
  Post,
  Patch,
  Param,
  Body,
  HttpException,
  UseGuards,
  HttpStatus,
  Req,
  Get,
  Delete,
  Inject,
  forwardRef,
  ValidationPipe,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { SessionUtil } from '../common/utils/session.util';
import { HouseholdService } from './services/household.service';
import { AccessCodeService } from './services/access-code.service';
import { ApplicationFormService } from '../application-form/services/application-form.service';
import { NotificationService } from '../notifications/services/notification.service';
import { CreateHouseholdMemberDto } from './dto/create-household-member.dto';
import { GetApplicationFormDto } from '../application-form/dto/get-application-form.dto';
import { UpdateHouseholdMemberDto } from './dto/update-household-member.dto';
import { HouseholdMembersDocument } from './schemas/household-members.schema';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
  ApiOkResponse,
} from '@nestjs/swagger';
import { HouseholdMemberWithFormsDto } from './dto/household-member-with-forms.dto';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { ApplicationFormStatus } from '../application-form/enums/application-form-status.enum';
import { PinoLogger } from 'nestjs-pino';
@ApiTags('Household Members')
@Controller('application-package/:applicationPackageId/household-members')
@UseGuards(SessionAuthGuard)
export class HouseholdController {
  constructor(
    private readonly householdService: HouseholdService,
    @Inject(forwardRef(() => ApplicationFormService))
    private readonly applicationFormService: ApplicationFormService,
    private readonly accessCodeService: AccessCodeService,
    private readonly notificationService: NotificationService,
    private readonly sessionUtil: SessionUtil,
    private readonly logger: PinoLogger,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new household member' })
  @ApiParam({ name: 'applicationPackageId', type: String })
  @ApiBody({ type: CreateHouseholdMemberDto })
  @ApiResponse({
    status: 201,
    description: 'Household member created successfully.',
  })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  async create(
    @Param('applicationPackageId', new ParseUUIDPipe())
    applicationPackageId: string,
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: CreateHouseholdMemberDto,
    @Req() request: Request,
  ): Promise<HouseholdMembersDocument> {
    this.logger.info(
      `Received request to create household member for applicationPackageId=${applicationPackageId}`,
    );
    const userId = this.sessionUtil.extractUserIdFromRequest(request);
    const hasAccess = await this.householdService.verifyUserOwnsPackage(
      applicationPackageId,
      userId,
    );
    if (!hasAccess) {
      throw new UnauthorizedException(
        'Not authorized to modify this application package',
      );
    }

    try {
      return await this.householdService.createMember(dto);
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(
        `Error creating household member: ${err.message}`,
        err.stack,
      );
      throw new HttpException(
        'Failed to create household member',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  @ApiOperation({ summary: 'Get household members by applicationPackageId' })
  @ApiParam({ name: 'applicationPackageId', type: String })
  @ApiOkResponse({
    description: 'List of household members associated with the application',
    type: [CreateHouseholdMemberDto],
  })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  async getAllHouseholdMembers(
    @Param('applicationPackageId', new ParseUUIDPipe())
    applicationPackageId: string,
    @Req() request: Request,
  ): Promise<HouseholdMembersDocument[]> {
    const userId = this.sessionUtil.extractUserIdFromRequest(request);
    const isOwner = await this.householdService.verifyUserOwnsPackage(
      applicationPackageId,
      userId,
    );
    if (!isOwner) {
      throw new UnauthorizedException(
        'Not authorized to view this application package',
      );
    }
    try {
      return await this.householdService.findAllHouseholdMembers(
        applicationPackageId,
      );
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(
        `Error retrieving household: ${err.message}`,
        err.stack,
      );
      throw new HttpException(
        'Failed to retrieve household members',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':householdMemberId')
  @ApiOperation({
    summary: 'Get household member details by householdMemberId',
  })
  @ApiParam({ name: 'householdMemberId', type: String })
  @ApiOkResponse({
    description: 'Information associated with the household member',
    type: HouseholdMemberWithFormsDto,
  })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  async getHouseholdMember(
    @Param('householdMemberId', new ParseUUIDPipe())
    householdMemberId: string,
    @Req() request: Request,
  ): Promise<HouseholdMemberWithFormsDto | null> {
    const userId = this.sessionUtil.extractUserIdFromRequest(request);
    const hasAccess =
      await this.householdService.verifyUserOwnsHouseholdMemberPackage(
        householdMemberId,
        userId,
      );
    if (!hasAccess) {
      throw new UnauthorizedException(
        'Not authorized to view this household member',
      );
    }
    try {
      const householdMember =
        await this.householdService.findById(householdMemberId);

      if (!householdMember) {
        throw new HttpException(
          'Household member not found',
          HttpStatus.NOT_FOUND,
        );
      }

      let applicationForms: GetApplicationFormDto[] = [];

      // Get application forms if user is associated
      if (householdMember.userId) {
        applicationForms =
          await this.applicationFormService.getApplicationFormsByUser(
            householdMember.userId,
          );
      } else {
        // otherwise get the forms for this household member
        applicationForms =
          await this.applicationFormService.getApplicationFormByHouseholdId(
            householdMemberId,
          );
      }

      return {
        householdMember,
        applicationForms,
      };
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(
        `Error retrieving household member: ${err.message}`,
        err.stack,
      );
      throw new HttpException(
        'Failed to retrieve household member',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(':householdMemberId/confirm-screening-package')
  @ApiOperation({
    summary: 'Confirm screening package completion by household member',
    description:
      'Called when household member reviews and confirms their screening package submission',
  })
  async confirmScreeningPackage(
    @Param('householdMemberId', new ParseUUIDPipe()) householdMemberId: string,
    @Req() request: Request,
  ): Promise<{ success: boolean; message: string }> {
    const userId = this.sessionUtil.extractUserIdFromRequest(request);

    // verify the user is associated with this household member
    const member = await this.householdService.findById(householdMemberId);
    if (!member) {
      throw new NotFoundException('Household member not found');
    }

    if (member.userId !== userId) {
      throw new UnauthorizedException('Not authorized');
    }
    // get all screeningforms for the household member
    const forms =
      await this.applicationFormService.getApplicationFormByHouseholdId(
        householdMemberId,
      );
    const incompleteForms = forms.filter(
      (form) => form.status !== ApplicationFormStatus.COMPLETE,
    );

    if (incompleteForms.length > 0) {
      throw new BadRequestException(
        `Cannot confirm screening package - ${incompleteForms.length} of ${forms.length} forms 
  are incomplete`,
      );
    }
    await this.householdService.markScreeningProvided(householdMemberId);
    this.logger.info(
      `Household member ${householdMemberId} confirmed screening package completion (${forms.length} forms)`,
    );

    return {
      success: true,
      message: `Screening package confirmed (${forms.length} forms completed)`,
    };
  }

  @Post(':householdMemberId/mark-screening-documents-attached')
  @ApiOperation({
    summary: 'Mark all screening documents as attached for a household member',
    description:
      'Called when primary applicant confirms they have uploaded all screening documents on behalf of household member',
  })
  @ApiResponse({
    status: 200,
    description:
      'All screening forms marked as complete with attached documents',
  })
  @ApiResponse({
    status: 400,
    description: 'No screening forms found for household member',
  })
  async markScreeningDocumentsAttached(
    @Param('applicationPackageId', new ParseUUIDPipe())
    applicationPackageId: string,
    @Param('householdMemberId', new ParseUUIDPipe()) householdMemberId: string,
    @Req() request: Request,
  ): Promise<{ success: boolean; formsUpdated: number }> {
    const userId = this.sessionUtil.extractUserIdFromRequest(request);

    // Verify household member exists and belongs to this application package
    const member = await this.householdService.findById(householdMemberId);
    if (!member) {
      throw new NotFoundException('Household member not found');
    }

    if (member.applicationPackageId !== applicationPackageId) {
      throw new UnauthorizedException(
        'Household member does not belong to this application package',
      );
    }

    // Get all application forms for this household member
    const forms =
      await this.applicationFormService.getApplicationFormByHouseholdId(
        householdMemberId,
      );

    if (forms.length === 0) {
      throw new NotFoundException(
        `No forms found for household member ${householdMemberId}`,
      );
    }

    // Mark all screening forms as complete with user-attached documents
    await this.applicationFormService.markUserAttachedForms(
      householdMemberId,
      userId,
    );

    // Mark household member screening as provided
    await this.householdService.markScreeningProvided(householdMemberId);

    this.logger.info(
      `Marked ${forms.length} screening form(s) as attached for household member 
  ${householdMemberId}`,
    );

    return {
      success: true,
      formsUpdated: forms.length,
    };
  }

  @Get(':householdMemberId/access-code')
  async getAccessCode(
    @Param('applicationPackageId', new ParseUUIDPipe())
    applicationPackageId: string,
    @Param('householdMemberId', new ParseUUIDPipe()) householdMemberId: string,
    @Req() request: Request,
  ): Promise<{
    accessCode: string;
    expiresAt: Date;
    isUsed: boolean;
    attemptCount: number;
  }> {
    const userId = this.sessionUtil.extractUserIdFromRequest(request);

    // Verify user owns the application package that this household member belongs to
    const hasAccess =
      await this.householdService.verifyUserOwnsHouseholdMemberPackage(
        householdMemberId,
        userId,
      );

    if (!hasAccess) {
      throw new UnauthorizedException(
        'User does not have access to this householdMember',
      );
    }

    const accessCode =
      await this.accessCodeService.getLatestAccessCode(householdMemberId);

    if (!accessCode) {
      throw new NotFoundException(
        `No access code found for household member ${householdMemberId}`,
      );
    }

    this.logger.info(
      `Retrieved access code for household member ${householdMemberId}`,
    );

    return accessCode;
  }

  // if the primary applicant made an error entering the household information
  // we may need to enable the primary applicant to update their information
  @Patch(':householdMemberId')
  @ApiOperation({
    summary:
      'Update household member info (only before access code is redeemed)',
  })
  async updateMemberInfo(
    @Param('applicationPackageId', new ParseUUIDPipe())
    applicationPackageId: string,
    @Param('householdMemberId', new ParseUUIDPipe()) householdMemberId: string,
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: UpdateHouseholdMemberDto,
    @Req() request: Request,
  ): Promise<HouseholdMembersDocument> {
    const userId = this.sessionUtil.extractUserIdFromRequest(request);
    const hasAccess = await this.householdService.verifyUserOwnsPackage(
      applicationPackageId,
      userId,
    );
    if (!hasAccess) {
      throw new UnauthorizedException(
        'Not authorized to modify this application package',
      );
    }

    const member = await this.householdService.findById(householdMemberId);
    if (!member) {
      throw new NotFoundException('Household member not found');
    }
    if (member.userId !== null) {
      throw new BadRequestException(
        'Cannot edit a household member who has already redeemed their access code',
      );
    }
    if (member.screeningInfoProvided) {
      throw new BadRequestException(
        'Cannot edit a household member whose screening has been submitted',
      );
    }

    const isEditable =
      await this.householdService.verifyPackageEditable(applicationPackageId);
    if (!isEditable) {
      throw new BadRequestException(
        'Application package is not in an editable state',
      );
    }

    return this.householdService.updateHouseholdMember(householdMemberId, {
      lastName: dto.lastName,
      dateOfBirth: dto.dateOfBirth,
      email: dto.email,
    });
  }

  @Post(':householdMemberId/access-code/resend')
  @ApiOperation({ summary: 'Resend access code to household member' })
  async resendAccessCode(
    @Param('applicationPackageId', new ParseUUIDPipe())
    applicationPackageId: string,
    @Param('householdMemberId', new ParseUUIDPipe()) householdMemberId: string,
    @Req() request: Request,
  ): Promise<{
    accessCode: string;
    expiresAt: Date;
    isNew: boolean;
    resendsRemainingToday: number;
  }> {
    const userId = this.sessionUtil.extractUserIdFromRequest(request);
    const hasAccess = await this.householdService.verifyUserOwnsPackage(
      applicationPackageId,
      userId,
    );
    if (!hasAccess) {
      throw new UnauthorizedException(
        'Not authorized to modify this application package',
      );
    }

    const member = await this.householdService.findById(householdMemberId);
    if (!member) {
      throw new NotFoundException('Household member not found');
    }
    if (member.userId !== null) {
      throw new BadRequestException(
        'Cannot resend access code to a member who has already logged in',
      );
    }
    if (member.screeningInfoProvided) {
      throw new BadRequestException(
        'Cannot resend access code after screening has been submitted',
      );
    }

    const resendCheck =
      await this.householdService.canResendAccessCode(householdMemberId);
    if (!resendCheck.canResend) {
      if (resendCheck.reason === 'cooldown') {
        throw new BadRequestException(
          `Please wait ${resendCheck.cooldownMinutesRemaining} minute(s) before resending`,
        );
      }
      throw new BadRequestException(
        'Daily resend limit reached. Try again tomorrow.',
      );
    }

    const { accessCode, expiresAt, isNew } =
      await this.accessCodeService.resendOrCreateAccessCode(
        applicationPackageId,
        householdMemberId,
      );

    await this.householdService.incrementResendTracking(householdMemberId);
    // send email notification to household member about access code.
    if (member.email) {
      const householdMemberName = member.firstName + ' ' + member.lastName;
      const primaryApplicant =
        await this.householdService.findPrimaryApplicant(applicationPackageId);
      if (primaryApplicant) {
        // there WILL be a primary applicant
        const primaryApplicantName =
          primaryApplicant.firstName + ' ' + primaryApplicant.lastName;
        await this.notificationService.sendFCHAccessCode(
          member.email,
          primaryApplicantName,
          householdMemberName,
          accessCode,
        );
      }
    }

    this.logger.info(
      `Re-sent access code for household member ${householdMemberId} (isNew=${isNew})`,
    );

    return {
      accessCode,
      expiresAt,
      isNew,
      resendsRemainingToday: resendCheck.resendsRemainingToday - 1,
    };
  }

  @Delete(':householdMemberId')
  @ApiOperation({ summary: 'Delete household member by householdMemberId' })
  @ApiParam({ name: 'householdMemberId', type: String })
  @ApiOkResponse({
    description: 'Household Member deleted successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: {
          type: 'string',
          example: 'Household member deleted successfully',
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Household member not found.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  async deleteHouseholdMember(
    @Param('householdMemberId', new ParseUUIDPipe())
    householdMemberId: string,
    @Req() request: Request,
  ): Promise<{ success: boolean; message: string }> {
    const userId = this.sessionUtil.extractUserIdFromRequest(request);
    const hasAccess =
      await this.householdService.verifyUserOwnsHouseholdMemberPackage(
        householdMemberId,
        userId,
      );
    if (!hasAccess) {
      throw new UnauthorizedException(
        'Not authorized to delete this household member',
      );
    }
    try {
      const result = await this.householdService.remove(householdMemberId);
      return {
        success: result,
        message: 'Household member deleted successfully',
      };
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(
        `Error deleting household member: ${err.message}`,
        err.stack,
      );
      throw new HttpException(
        'Failed to delete household member',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
