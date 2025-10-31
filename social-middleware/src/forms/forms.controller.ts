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
import { SessionAuthGuard } from 'src/auth/session-auth.guard';

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
}
