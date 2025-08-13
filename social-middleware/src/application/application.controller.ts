/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  UnauthorizedException,
  UseGuards,
  Put,
} from '@nestjs/common';
import { ApplicationService } from './application.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { GetApplicationsDto } from './dto/get-applications.dto';
import { GetApplicationsQueryDto } from './dto/get-applications-query.dto';
import { SessionAuthGuard } from 'src/auth/session-auth.guard';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import { ConfigService } from '@nestjs/config';
import { SubmitApplicationDto } from './dto/submit-application-dto';
@ApiTags('Application')
@Controller('application')
export class ApplicationController {
  private readonly jwtSecret: string;

  constructor(
    private readonly applicationService: ApplicationService,
    private readonly configService: ConfigService,
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
  ): Promise<{ formAccessToken: string }> {
    try {
      const sessionToken = request.cookies?.session;

      if (!sessionToken) {
        throw new UnauthorizedException('No session token provided.');
      }

      const decoded = jwt.verify(sessionToken, this.jwtSecret) as any;
      const mongoUserId = decoded.userId;

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
      const sessionToken = request.cookies?.session;

      if (!sessionToken) {
        throw new UnauthorizedException('No session token provided');
      }

      // Decode JWT token (same as your auth/status endpoint)
      const decoded = jwt.verify(sessionToken, this.jwtSecret!) as any;

      //const userId = decoded.sub;
      const mongoUserId = decoded.userId;

      console.log('Getting Applications For UserID:', mongoUserId);

      return this.applicationService.getApplicationsByUser(mongoUserId);
    } catch (error) {
      console.error('JWT verification error:', error);
      throw new UnauthorizedException('Invalid or expired session');
    }
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
}
