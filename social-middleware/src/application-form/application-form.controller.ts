import {
  Controller,
  Query,
  Req,
  Get,
  Put,
  UseGuards,
  Body,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Request } from 'express';
import { NewTokenDto } from './dto/new-token.dto';
import { SubmitApplicationFormDto } from './dto/submit-application-form.dto';
import { SessionAuthGuard } from 'src/auth/session-auth.guard';
import { ApplicationFormService } from './application-form.service';
import { SessionUtil } from 'src/common/utils/session.util';
import { PinoLogger } from 'nestjs-pino';

@ApiBearerAuth()
@ApiTags('Application Forms')
@Controller('application-forms')
export class ApplicationFormsController {
  constructor(
    private readonly applicationFormsService: ApplicationFormService,
    private readonly sessionUtil: SessionUtil,
    private readonly logger: PinoLogger,
  ) {}

  @Put('submit')
  @ApiOperation({ summary: 'Update application form data' })
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
    return await this.applicationFormsService.submitApplicationForm(dto);
  }

  @Get('token')
  @UseGuards(SessionAuthGuard)
  @ApiOperation({ summary: 'Get form access token by application ID' })
  @ApiQuery({
    name: 'applicationId',
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
    @Query('applicationId') applicationId: string,
    @Req() request: Request,
  ): Promise<{ formAccessToken: string }> {
    const userId = this.sessionUtil.extractUserIdFromRequest(request);

    const dto: NewTokenDto = {
      applicationId,
    };

    const formAccessToken =
      await this.applicationFormsService.newFormAccessToken(dto, userId);
    return { formAccessToken };
  }
}
