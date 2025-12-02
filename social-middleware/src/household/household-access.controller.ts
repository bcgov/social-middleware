import {
  Controller,
  Post,
  Body,
  Req,
  Logger,
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

@ApiTags('Household Access Codes')
@Controller('household')
export class HouseholdAccessCodeController {
  private readonly logger = new Logger(HouseholdAccessCodeController.name);

  constructor(
    private readonly accessCodeService: AccessCodeService,
    private readonly sessionUtil: SessionUtil,
    private readonly userService: UserService,
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
    applicationFormId?: string;
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
          applicationFormId: result.applicationFormId,
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
}
