import {
  Controller,
  Post,
  Get,
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
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { GetApplicationsDto } from './dto/get-applications.dto';
import { SessionAuthGuard } from 'src/auth/session-auth.guard';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import { ConfigService } from '@nestjs/config';
import { SubmitApplicationDto } from './dto/submit-application-dto';
import { PinoLogger } from 'nestjs-pino';
@ApiTags('Application')
@Controller('application')
export class ApplicationController {
  private readonly jwtSecret: string;

  constructor(
    private readonly applicationService: ApplicationService,
    private readonly userService: UserService,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.jwtSecret = this.configService.get<string>('JWT_SECRET')!;
  }

  @Post()
  @ApiOperation({ summary: 'Create a new application' })
  @ApiResponse({
    status: 201,
    description:
      'Application created successfully and form access token returned',
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({
    status: 500,
    description: 'Server error during application creation',
  })
  async createApplication(
    @Body() dto: CreateApplicationDto,
    @Req() request: Request,
  ): Promise<{ applicationId: string }> {
    try {
      const sessionToken = request.cookies?.session as string;

      if (!sessionToken) {
        throw new UnauthorizedException('No session token provided.');
      }

      const decoded = jwt.verify(
        sessionToken,
        this.jwtSecret,
      ) as jwt.JwtPayload;

      const mongoUserId = decoded.userId as string;

      return this.applicationService.createApplication(dto, mongoUserId);
    } catch (error) {
      console.error('JWT verification error:', error);
      throw new UnauthorizedException('Invalid or expired session');
    }
  }

  @Get()
  @ApiOperation({ summary: 'Get applications by authenticated user' })
  //@ApiQuery({ name: 'userId', required: true, type: String })
  @ApiResponse({
    status: 200,
    description: 'List of applications for authenticated user',
    type: [GetApplicationsDto],
  })
  @UseGuards(SessionAuthGuard)
  async getApplications(
    @Req() request: Request & { session?: any; user?: any },
  ): Promise<GetApplicationsDto[]> {
    try {
      const sessionToken = request.cookies?.session as string;

      if (!sessionToken) {
        throw new UnauthorizedException('No session token provided');
      }

      // Decode JWT token
      const decoded = jwt.verify(
        sessionToken,
        this.jwtSecret,
      ) as jwt.JwtPayload;

      //const userId = decoded.sub;
      const mongoUserId = decoded.userId as string;

      console.log('Getting Applications For UserID:', mongoUserId);

      return this.applicationService.getApplicationsByUser(mongoUserId);
    } catch (error) {
      console.error('JWT verification error:', error);
      throw new UnauthorizedException('Invalid or expired session');
    }
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
    //@Req() req: any,
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
      const sessionToken = request.cookies?.session as string;

      if (!sessionToken) {
        throw new UnauthorizedException('No session token provided.');
      }

      const decoded = jwt.verify(
        sessionToken,
        this.jwtSecret,
      ) as jwt.JwtPayload;
      const mongoUserId = decoded.userId as string;

      this.logger.debug({ decoded }, 'Associating access code with user');

      const user = await this.userService.findOne(mongoUserId);
      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      const userData = {
        lastName: user.last_name,
        dateOfBirth: user.dateOfBirth,
      };

      this.logger.debug(
        { accessCode: dto.accessCode, mongoUserId, userData },
        'Associating access code with user',
      );

      const result = await this.applicationService.associateUserWithAccessCode(
        dto.accessCode,
        mongoUserId,
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
      console.error('Access code association error:', error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to associate access code';
      return { success: false, message: errorMessage };
    }
  }
}
