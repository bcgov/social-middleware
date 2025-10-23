// application-submission.controller.ts
import {
  Controller,
  Body,
  Req,
  UnauthorizedException,
  NotFoundException,
  Put,
  Param,
  ValidationPipe,
} from '@nestjs/common';
import { ApplicationSubmissionService } from './application-submission.service';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { UpdateSubmissionStatusDto } from './dto/update-submission-status.dto';
import { ApplicationSubmission } from './schemas/application-submission.schema';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { ApplicationService } from '../application/application.service';
import { UserPayload } from '../common/interfaces/user-payload.interface';
import { isValidUserPayload, extractUserId } from '../common/utils/';
import { UpdateSubmissionStatusParamsDto } from './dto/update-submission-status-params.dto';

@ApiTags('Application Submission')
@Controller('application-submission')
export class ApplicationSubmissionController {
  private readonly jwtSecret: string;

  constructor(
    private readonly applicationSubmissionService: ApplicationSubmissionService,
    private readonly applicationService: ApplicationService,
    private readonly configService: ConfigService,
  ) {
    this.jwtSecret = this.configService.get<string>('JWT_SECRET')!;
  }

  @Put(':applicationFormId/status')
  async updateSubmissionStatus(
    @Param(new ValidationPipe({ whitelist: true, transform: true }))
    params: UpdateSubmissionStatusParamsDto,
    @Req() req: Request,
    @Body() updateDto: UpdateSubmissionStatusDto,
  ): Promise<ApplicationSubmission> {
    try {
      // extract userID
      const sessionToken = req.cookies?.session as string | undefined;

      if (!sessionToken) {
        throw new UnauthorizedException('No session token provided.');
      }

      const decoded = jwt.verify(sessionToken, this.jwtSecret) as UserPayload;

      if (!isValidUserPayload(decoded)) {
        throw new Error('Invalid session token payload');
      }

      const userId = extractUserId(decoded);

      // verify ownership before proceeding
      const application = await this.applicationService.findByIdAndUser(
        params.applicationFormId,
        userId,
      );

      if (!application) {
        throw new NotFoundException(`Application not found or access denied.`);
      }
      // Proceed with updating the submission status

      return this.applicationSubmissionService.updateSubmissionStatus(
        params.applicationFormId,
        updateDto,
      );
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof NotFoundException
      ) {
        throw error; // Re-throw known exceptions
      }
      console.error('JWT verification error:', error);
      throw new UnauthorizedException('Invalid session token.');
    }
  }
}
