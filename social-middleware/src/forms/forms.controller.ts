import { Controller, Post, Body } from '@nestjs/common';
import { FormsService } from './forms.service';
import { ValidateTokenDto } from './dto/validate-token.dto';

@Controller('forms')
export class FormsController {
  constructor(private readonly formsService: FormsService) {}

  @Post('validateTokenAndGetParameters')
  validateTokenAndGetParameters(@Body() dto: ValidateTokenDto) {
    return this.formsService.validateTokenAndGetParameters(dto);
  }

  @Post('expireToken')
  expireToken(@Body() dto: ValidateTokenDto) {
    return this.formsService.expireToken(dto);
  }
}
