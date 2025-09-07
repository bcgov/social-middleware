import { Controller, Post, Body, Get, UseGuards, Query } from '@nestjs/common';
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
  validateTokenAndGetParameters(@Body() dto: ValidateTokenDto) {
    return this.formsService.validateTokenAndGetParameters(dto);
  }

  @Get('token')
  @UseGuards(SessionAuthGuard)
  @ApiOperation({ summary: 'Get form access token by application ID' })
  @ApiQuery({ name: 'applicationId', required: true, description: 'The application ID to get the form access token for'})
  @ApiResponse({ status: 200, description: 'Form access token retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized - invalid or missing session' })
  @ApiResponse({ status: 404, description: 'No form parameters found for the given application ID' })
  @ApiResponse({ status: 500, description: 'Internal server error' }) 
  getFormAccessToken(@Query() dto: GetTokenDto) {
    return this.formsService.getFormAccessToken(dto);
  }
}
