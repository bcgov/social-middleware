import { Controller, Post, Body } from '@nestjs/common';
import { FormsService } from './forms.service';
import { ValidateTokenDto } from './dto/validate-token.dto';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
@ApiTags('Forms')
@Controller('forms')
export class FormsController {
  constructor(private readonly formsService: FormsService) {}

  @Post('validateTokenAndGetParameters')
  @ApiOperation({ summary: 'Validate form token and get form parameters' })
  @ApiResponse({
    status: 200,
    description: 'Returns the form parameters if the token is valid',
    schema: {
      type: 'object',
      additionalProperties: true, // since you're returning a dynamic JSON
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Token has expired or is invalid',
  })
  @ApiResponse({
    status: 404,
    description: 'No form parameters found for the provided token',
  })
  @ApiResponse({
    status: 500,
    description: 'Server error during token validation',
  })
  validateTokenAndGetParameters(@Body() dto: ValidateTokenDto) {
    return this.formsService.validateTokenAndGetParameters(dto);
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
