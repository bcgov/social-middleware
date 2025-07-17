import { Controller, Post, Body } from '@nestjs/common';
import { ApplicationService } from './application.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Application')
@Controller('application')
export class ApplicationController {
    constructor(private readonly applicationService: ApplicationService) { }

    @Post()
    @ApiOperation({ summary: 'Create a new application' })
    @ApiResponse({
        status: 201,
        description: 'Application created successfully and form access token returned',
    })
    @ApiResponse({ status: 400, description: 'Validation error' })
    @ApiResponse({ status: 500, description: 'Server error during application creation' })
    async createApplication(@Body() dto: CreateApplicationDto) {
        return this.applicationService.createApplication(dto);
    }
}
