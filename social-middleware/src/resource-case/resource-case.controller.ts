import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Get,
  Req,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SessionUtil } from '../common/utils/session.util';
import { RequestHouseholdRemovalDto } from './dto/request-household-removal.dto';
import { ResourceCaseService } from './resource-case.service';
import { ConfigService } from '@nestjs/config';

@ApiTags('Resource Case')
@Controller('resource-case')
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class ResourceCaseController {
  constructor(
    private readonly resourceCaseService: ResourceCaseService,
    private readonly sessionUtil: SessionUtil,
    private readonly configService: ConfigService,
  ) {}

  @Get('household-contacts')
  @ApiOperation({
    summary: 'List the adult household members on my resource case',
  })
  async listHouseholdContacts(@Req() request: Request) {
    if (this.configService.get<string>('TEST_RESOURCE_CASE') !== 'true')
      return [];
    const userId = this.sessionUtil.extractUserIdFromRequest(request);
    return this.resourceCaseService.listHouseholdContacts(userId);
  }

  @Post('household-contacts/:caseContactId/removal')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Request removal of an adult household member',
    description:
      'Marks the contact as removal requested, stores the departure date and notifies the social worker assigned to the resource case. The contact stays on the case until the social worker sets the end date in ICM.',
  })
  @ApiResponse({ status: 204, description: 'Removal requested' })
  @ApiResponse({ status: 400, description: 'Invalid departure date' })
  @ApiResponse({ status: 403, description: 'No open resource case' })
  @ApiResponse({ status: 404, description: 'Household member not found' })
  @ApiResponse({ status: 409, description: 'Removal already requested' })
  @ApiResponse({ status: 422, description: 'No social worker assigned' })
  async requestHouseholdRemoval(
    @Req() request: Request,
    @Param('caseContactId') caseContactId: string,
    @Body() dto: RequestHouseholdRemovalDto,
  ): Promise<void> {
    if (this.configService.get<string>('TEST_RESOURCE_CASE') !== 'true')
      throw new ForbiddenException('No open resource case');
    const userId = this.sessionUtil.extractUserIdFromRequest(request);
    await this.resourceCaseService.requestHouseholdMemberRemoval(
      userId,
      caseContactId,
      dto.departure_date,
    );
  }
}
