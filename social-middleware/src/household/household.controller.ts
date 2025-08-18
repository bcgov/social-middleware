import {
  Controller,
  Post,
  Param,
  Body,
  Logger,
  HttpException,
  HttpStatus,
  Get,
  Delete,
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
  ApiOkResponse,
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

  @Get()
  @ApiOperation({ summary: 'Get household members by applicationId' })
  @ApiParam({ name: 'applicationId', type: String })
  @ApiOkResponse({
    description: 'List of household members associated with the application',
    type: [CreateHouseholdMemberDto],
  })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  async getAllHouseholdMembers(
    @Param('applicationId') applicationId: string,
  ): Promise<HouseholdMembersDocument[]> {
    try {
      return await this.householdService.findAllHouseholdMembers(applicationId);
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(
        `Error retrieving household: ${err.message}`,
        err.stack,
      );
      throw new HttpException(
        'Failed to retrieve household members',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(':householdMemberId')
  @ApiOperation({ summary: 'Delete household member by householdMemberId' })
  @ApiParam({ name: 'householdMemberId', type: String })
  @ApiOkResponse({
    description: 'Household Member deleted successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: {
          type: 'string',
          example: 'Household member deleted successfully',
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Household member not found.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  async deleteHouseholdMember(
    @Param('householdMemberId') householdMemberId: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const result = await this.householdService.remove(householdMemberId);
      return {
        success: result,
        message: 'Household member deleted successfully',
      };
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(
        `Error deleting household member: ${err.message}`,
        err.stack,
      );
      throw new HttpException(
        'Failed to delete household member',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
