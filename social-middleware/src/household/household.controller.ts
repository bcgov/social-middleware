import {
  Controller,
  Post,
  Param,
  Body,
  Logger,
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
} from '@nestjs/common';
import { Request } from 'express';
import { SessionUtil } from '../common/utils/session.util';
import { HouseholdService } from './services/household.service';
import { AccessCodeService } from './services/access-code.service';
import { ApplicationFormService } from '../application-form/services/application-form.service';
import { CreateHouseholdMemberDto } from './dto/create-household-member.dto';
import { GetApplicationFormDto } from '../application-form/dto/get-application-form.dto';
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
//TODO: ADD SESSION AUTH GUARD
@ApiTags('Household Members')
@Controller('application-package/:applicationPackageId/household-members')
export class HouseholdController {
  private readonly logger = new Logger(HouseholdController.name);
  constructor(
    private readonly householdService: HouseholdService,
    @Inject(forwardRef(() => ApplicationFormService))
    private readonly applicationFormService: ApplicationFormService,
    private readonly accessCodeService: AccessCodeService,
    private readonly sessionUtil: SessionUtil,
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
    @Param('applicationPackageId', new ValidationPipe({ transform: true }))
    applicationPackageId: string,
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: CreateHouseholdMemberDto,
  ): Promise<HouseholdMembersDocument> {
    this.logger.log(
      `Received request to create household member for applicationPackageId=${applicationPackageId}`,
    );
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
    @Param('applicationPackageId', new ValidationPipe({ transform: true }))
    applicationPackageId: string,
  ): Promise<HouseholdMembersDocument[]> {
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
    @Param('householdMemberId', new ValidationPipe({ transform: true }))
    householdMemberId: string,
  ): Promise<HouseholdMemberWithFormsDto | null> {
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
  @UseGuards(SessionAuthGuard)
  @ApiOperation({
    summary: 'Confirm screening package completion by household member',
    description:
      'Called when household member reviews and confirms their screening package submission',
  })
  async confirmScreeningPackage(
    @Param('householdMemberId') householdMemberId: string,
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
    this.logger.log(
      `Household member ${householdMemberId} confirmed screening package completion (${forms.length} forms)`,
    );

    return {
      success: true,
      message: `Screening package confirmed (${forms.length} forms completed)`,
    };
  }

  @Post(':householdMemberId/mark-screening-documents-attached')
  @UseGuards(SessionAuthGuard)
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
    @Param('applicationPackageId') applicationPackageId: string,
    @Param('householdMemberId') householdMemberId: string,
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

    this.logger.log(
      `Marked ${forms.length} screening form(s) as attached for household member 
  ${householdMemberId}`,
    );

    return {
      success: true,
      formsUpdated: forms.length,
    };
  }

  @Get(':householdMemberId/access-code')
  @UseGuards(SessionAuthGuard)
  async getAccessCode(
    @Param('applicationPackageId') applicationPackageId: string,
    @Param('householdMemberId') householdMemberId: string,
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

    this.logger.log(
      `Retrieved access code for household member ${householdMemberId}`,
    );

    return accessCode;
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
    @Param('householdMemberId', new ValidationPipe({ transform: true }))
    householdMemberId: string,
  ): Promise<{ success: boolean; message: string }> {
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
