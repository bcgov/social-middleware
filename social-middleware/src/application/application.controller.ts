import {
  Controller,
  Post,
  Get,
  HttpCode,
  Delete,
  Body,
  Param,
  Req,
  UnauthorizedException,
  UseGuards,
  Put,
} from '@nestjs/common';
import { ApplicationService } from './application.service';
import { UserService } from 'src/auth/user.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { DeleteApplicationDto } from './dto/delete-application.dto';
import { SessionUtil } from 'src/common/utils/session.util';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { GetApplicationsDto } from './dto/get-applications.dto';
import { SessionAuthGuard } from 'src/auth/session-auth.guard';
import { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { SubmitApplicationDto } from './dto/submit-application-dto';
import { PinoLogger } from 'nestjs-pino';
@ApiBearerAuth()
@ApiTags('Application')
@Controller('application')
export class ApplicationController {
  private readonly jwtSecret: string;

  constructor(
    private readonly applicationService: ApplicationService,
    private readonly userService: UserService,
    private readonly sessionUtil: SessionUtil,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.jwtSecret = this.configService.get<string>('JWT_SECRET')!;
    this.logger.setContext(ApplicationController.name);
  }

  @Post()
  @UseGuards(SessionAuthGuard)
  @ApiOperation({ summary: 'Create a new application' })
  @ApiResponse({
    status: 201,
    description:
      'Application created successfully and form access token returned',
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing session',
  })
  @ApiResponse({
    status: 500,
    description: 'Server error during application creation',
  })
  async createApplication(
    @Body() dto: CreateApplicationDto,
    @Req() request: Request,
  ): Promise<{ applicationId: string }> {
    try {
      const userId = this.sessionUtil.extractUserIdFromRequest(request);
      return this.applicationService.createApplication(dto, userId);
    } catch (error) {
      this.logger.error(
        { error },
        'JWT verification error in createApplication',
      );
      throw new UnauthorizedException('Invalid or expired session');
    }
  }

  @Get()
  @UseGuards(SessionAuthGuard)
  @ApiOperation({ summary: 'Get applications by authenticated user' })
  //@ApiQuery({ name: 'userId', required: true, type: String })
  @ApiResponse({
    status: 200,
    description: 'List of applications for authenticated user',
    type: [GetApplicationsDto],
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing session',
  })
  async getApplications(
    @Req() request: Request & { session?: any; user?: any },
  ): Promise<GetApplicationsDto[]> {
    const userId = this.sessionUtil.extractUserIdFromRequest(request);
    return this.applicationService.getApplicationsByUser(userId);
  }

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
    @Param('applicationId') applicationId: string,
    @Param('householdMemberId') householdMemberId: string,
  ) {
    return await this.applicationService.createHouseholdScreening(
      applicationId,
      householdMemberId,
    );
  }

  @Put('submit')
  @ApiOperation({ summary: 'Submit application and update form data' })
  @ApiResponse({
    status: 200,
    description: 'Application data successfully updated',
  })
  @ApiResponse({ status: 404, description: 'Token or application not found' })
  @ApiResponse({
    status: 500,
    description: 'Server error during application submission',
  })
  async submitApplication(@Body() dto: SubmitApplicationDto) {
    return this.applicationService.submitApplication(dto);
  }

  @Delete(':applicationId')
  @UseGuards(SessionAuthGuard)
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete application data at users request' })
  @ApiResponse({
    status: 204,
    description: 'Application and associated records deleted successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request or application cannot be deleted',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid session',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - user cannot delete this application',
  })
  @ApiResponse({
    status: 404,
    description: 'Application not found',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal Server Error',
  })
  async cancelApplication(
    @Param('applicationId') applicationId: string,
    @Req() request: Request,
  ): Promise<void> {
    const userId = this.sessionUtil.extractUserIdFromRequest(request);
    const dto: DeleteApplicationDto = { applicationId };
    return this.applicationService.cancelApplication(dto, userId);
  }

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
    @Body() dto: { accessCode: string },
    @Req() request: Request,
  ): Promise<{
    success: boolean;
    screeningApplicationId?: string;
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

      const result = await this.applicationService.associateUserWithAccessCode(
        dto.accessCode,
        userId,
        userData,
      );

      if (result.success) {
        return {
          success: true,
          screeningApplicationId: result.screeningApplicationId,
          message: 'Access code associated successfully',
        };
      } else {
        return {
          success: false,
          message: result.error || 'Failed to associate access code',
        };
      }
    } catch (error) {
      this.logger.error({ error }, 'Access code association error');
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to associate access code';
      return { success: false, message: errorMessage };
    }
  }
}
