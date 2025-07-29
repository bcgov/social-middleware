import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  HouseholdMembers,
  HouseholdMembersDocument,
} from './schemas/household-members.schema';
import { CreateHouseholdMemberDto } from './dto/create-household-member.dto';

@Injectable()
export class HouseholdService {
  private readonly logger = new Logger(HouseholdService.name);

  constructor(
    @InjectModel(HouseholdMembers.name)
    private householdMemberModel: Model<HouseholdMembersDocument>,
  ) {}

  async createMember(
    applicationId: string,
    dto: CreateHouseholdMemberDto,
  ): Promise<HouseholdMembersDocument> {
    try {
      const created = new this.householdMemberModel({
        ...dto,
        applicationId,
      });

      const saved = await created.save();
      this.logger.log(
        `Created household member with ID: ${saved.householdMemberId} for applicationId: ${applicationId}`,
      );
      return saved;
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(
        `Failed to create household member for applicationId=${applicationId}: ${err.message}`,
        err.stack,
      );
      throw new InternalServerErrorException(
        'Could not create household member',
      );
    }
  }

  async findAllHouseholdMembers(
    applicationId: string,
  ): Promise<HouseholdMembersDocument[]> {
    try {
      const members = await this.householdMemberModel
        .find({ applicationId })
        .exec();
      return members;
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(
        `Error fetching household members for applicationId=${applicationId}: ${err.message}`,
        err.stack,
      );
      throw new InternalServerErrorException(
        'Failed to retrieve household members',
      );
    }
  }
}
