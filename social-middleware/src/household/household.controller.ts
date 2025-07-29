import {
  Controller,
  Post,
  Param,
  Body,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { HouseholdService } from './household.service';
import { CreateHouseholdMemberDto } from './dto/create-household-member.dto';
import { HouseholdMembersDocument } from './schemas/household-members.schema';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';

@ApiTags('Household Members')
@Controller('applications/:applicationId/household-members')
export class HouseholdController {
  private readonly logger = new Logger(HouseholdController.name);

  constructor(private readonly householdService: HouseholdService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new household member' })
  @ApiParam({ name: 'applicationId', type: String })
  @ApiBody({ type: CreateHouseholdMemberDto })
  @ApiResponse({
    status: 201,
    description: 'Household member created successfully.',
  })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  async create(
    @Param('applicationId') applicationId: string,
    @Body() dto: CreateHouseholdMemberDto,
  ): Promise<HouseholdMembersDocument> {
    this.logger.log(
      `Received request to create household member for applicationId=${applicationId}`,
    );
    try {
      return await this.householdService.createMember(applicationId, dto);
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(
        `Error creating household member: ${err.message}`,
        err.stack,
      );
      throw new HttpException(
        'Failed to create household member',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
