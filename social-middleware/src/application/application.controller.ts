import { Controller, Post, Body } from '@nestjs/common';
import { ApplicationService } from './application.service';
import { CreateApplicationDto } from './dto/create-application.dto';

@Controller('application')
export class ApplicationController {
  constructor(private readonly applicationService: ApplicationService) {}

  @Post()
  async createApplication(@Body() dto: CreateApplicationDto) {
    return this.applicationService.createApplication(dto);
  }
}
