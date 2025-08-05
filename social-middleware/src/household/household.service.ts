import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
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
      this.logger.log(
        `Creating household member for applicationId: ${applicationId}`,
      );

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

  async remove(id: string): Promise<HouseholdMembersDocument> {
    const deletedHouseholdMember = await this.householdMemberModel
      .findByIdAndDelete(id)
      .exec();
    if (!deletedHouseholdMember) {
      throw new NotFoundException(`Household Member with ID ${id} not found`);
    }
    return deletedHouseholdMember;
  }

  async findOrCreate(
    createHouseholdMemberDTO: CreateHouseholdMemberDto,
  ): Promise<HouseholdMembersDocument> {
    try {
      return await this.findByLastNameAndDOB(
        createHouseholdMemberDTO.lastName,
        createHouseholdMemberDTO.dateOfBirth,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        return this.createMember(
          createHouseholdMemberDTO.applicationId,
          createHouseholdMemberDTO,
        );
      }
      throw error;
    }
  }

  async findByLastNameAndDOB(
    lastName: string,
    dateOfBirth: string,
  ): Promise<HouseholdMembersDocument> {
    const user = await this.householdMemberModel
      .findOne({ lastName: lastName, dateOfBirth: dateOfBirth })
      .exec();
    if (!user) {
      throw new NotFoundException(
        `Household Member with lastName: "${lastName}" DOB: ${dateOfBirth}  not found`,
      );
    }
    return user;
  }
}
