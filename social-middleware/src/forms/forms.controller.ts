import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Query,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { FormsService } from './forms.service';
import { ValidateTokenDto } from './dto/validate-token.dto';
import { GetTokenDto } from './dto/get-token.dto';
import { GetTombstoneDataDto } from './dto/get-tombstone-data.dto';
import { SessionAuthGuard } from 'src/auth/session-auth.guard';
import { UserProfileResponse } from '../auth/interfaces/user-profile-response.interface';

@ApiTags('forms')
@Controller('forms')
export class FormsController {
  constructor(private readonly formsService: FormsService) {}

  @Post('validateTokenAndGetParameters')
  validateTokenAndGetParameters(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: ValidateTokenDto,
  ) {
    return this.formsService.validateTokenAndGetParameters(dto);
  }

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
  getFormAccessToken(@Query() dto: GetTokenDto) {
    return this.formsService.getFormAccessToken(dto);
  }

  @Post('validateTokenAndGetSavedJson')
  @ApiOperation({
    summary: 'Validate token and get saved form data as base64 JSON',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns base64-encoded JSON form data',
    schema: {
      type: 'object',
      properties: {
        form: {
          type: 'string',
          description: 'Base64-encoded JSON string of form data',
          example: 'eyJmaWVsZDEiOiAidmFsdWUxIn0=',
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'No form parameters or application found for the token',
  })
  @ApiResponse({ status: 400, description: 'Token has expired' })
  @ApiResponse({
    status: 500,
    description: 'Server error during validation',
  })
  validateTokenAndGetSavedJson(@Body() dto: ValidateTokenDto) {
    return this.formsService.validateTokenAndGetSavedJson(dto);
  }

  @Post('tombstone-data')
  @ApiOperation({
    summary: 'Get user tombstone data for form pre-population',
    description:
      'Returns user profile data to pre-fill form fields based on the form access token. ' +
      'The token must be the most recent for the application form. ' +
      'This allows forms to auto-populate user information without requiring re-entry.',
  })
  @ApiResponse({
    status: 200,
    description: 'Tombstone data retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        first_name: { type: 'string', example: 'John' },
        last_name: { type: 'string', example: 'Doe' },
        street_address: { type: 'string', example: '123 Main St' },
        city: { type: 'string', example: 'Victoria' },
        region: { type: 'string', example: 'BC' },
        postal_code: { type: 'string', example: 'V8W 1A1' },
        email: { type: 'string', example: 'john.doe@example.com' },
        home_phone: { type: 'string', example: '250-555-1234' },
        alternate_phone: { type: 'string', example: '250-555-5678' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Token is not the most recent for the form',
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found - Token, form, or user not found',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal Server Error',
  })
  async getTombstoneData(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: GetTombstoneDataDto,
  ): Promise<UserProfileResponse> {
    return this.formsService.getTombstoneDataByToken(dto.formAccessToken);
  }
}
