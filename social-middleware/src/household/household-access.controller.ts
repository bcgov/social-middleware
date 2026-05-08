import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  UnauthorizedException,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SessionUtil } from '../common/utils/session.util';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AccessCodeService } from './services/access-code.service';
import { UserService } from '../auth/user.service';
import { AssociateAccessCodeDto } from './dto/associate-access-code.dto';
import { PinoLogger } from 'nestjs-pino';
import { HouseholdService } from './services/household.service';
import { MemberTypes } from './enums/member-types.enum';

@ApiTags('Household Access Codes')
@Controller('household')
export class HouseholdAccessCodeController {
  constructor(
    private readonly accessCodeService: AccessCodeService,
    private readonly householdService: HouseholdService,
    private readonly sessionUtil: SessionUtil,
    private readonly userService: UserService,
    private readonly logger: PinoLogger,
  ) {}

  @Post('access-code/associate')
  @UseGuards(SessionAuthGuard)
  @ApiOperation({ summary: 'Associate an access code with a user account' })
  @ApiResponse({
    status: 200,
    description: 'Access code successfully associated with user account',
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 404, description: 'Access code not found' })
  @ApiResponse({
    status: 500,
    description: 'Server error during access code association',
  })
  async associateWithAccessCode(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: AssociateAccessCodeDto,
    @Req() request: Request,
  ): Promise<{
    success: boolean;
    householdMemberId?: string;
    message: string;
  }> {
    try {
      const userId = this.sessionUtil.extractUserIdFromRequest(request);

      const user = await this.userService.findOne(userId);
      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      const userData = {
        lastName: user.last_name,
        dateOfBirth: user.dateOfBirth,
      };

      this.logger.debug(
        { accessCode: dto.accessCode, userId, userData },
        'Associating access code with user',
      );

      const result = await this.accessCodeService.associateUserWithAccessCode(
        dto.accessCode,
        userId,
        userData,
      );

      if (result.success) {
        return {
          success: true,
          householdMemberId: result.householdMemberId ?? undefined,
          message: 'Access code associated successfully',
        };
      } else {
        return {
          success: false,
          message: result.error || 'Failed to associate access code',
        };
      }
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error({ error: err }, 'Access code association error');
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to associate access code';
      return { success: false, message: errorMessage };
    }
  }

  @Get('members')
  @UseGuards(SessionAuthGuard)
  @ApiOperation({ summary: 'Get household members for the authenticated user' })
  @ApiResponse({
    status: 200,
    description: 'List of household members for the user',
  })
  async getHouseholdMembersByUser(@Req() request: Request) {
    const userId = this.sessionUtil.extractUserIdFromRequest(request);
    const members = this.householdService.findByUserId(userId);
    return (await members)
      .filter((m) => m.memberType !== MemberTypes.Primary && m.requireScreening)
      .map((m) => ({
        householdMemberId: m.householdMemberId,
        applicationPackageId: m.applicationPackageId,
        memberType: m.memberType,
        screeningInfoProvided: m.screeningInfoProvided,
      }));
  }
}
