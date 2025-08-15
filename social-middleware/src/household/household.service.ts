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
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class HouseholdService {
  private readonly logger = new Logger(HouseholdService.name);

  constructor(
    @InjectModel(HouseholdMembers.name)
    private householdMemberModel: Model<HouseholdMembersDocument>,
  ) {}

  // create a household member
  async createMember(
    applicationId: string,
    dto: CreateHouseholdMemberDto,
  ): Promise<HouseholdMembersDocument> {
    try {
      let { householdMemberId, ...memberData } = dto;

      // householdMemberId is used by the front-end to refer to the record in the DB so we can perform RUD operations
      // if no householdMemberId is provided, generate one
      if (!householdMemberId) {
        householdMemberId = uuidv4();
        this.logger.log(
          `Generated new householdMemberId: ${householdMemberId}`,
        );
      } else {
        this.logger.log(
          `Using provided householdMemberId: ${householdMemberId}`,
        );
      }

      const result = await this.householdMemberModel
        .findOneAndUpdate(
          {
            householdMemberId: householdMemberId,
            applicationId: applicationId,
          },
          {
            $set: {
              ...memberData,
              householdMemberId,
              applicationId,
            },
          },
          {
            new: true,
            upsert: true, //update a record if it exists, otherwise create a new one.
            runValidators: true,
            setDefaultsOnInsert: true,
          },
        )
        .exec();

      this.logger.log(
        `Successfully upserted household member with ID: ${result.householdMemberId} for applicationId: ${applicationId}`,
      );
      return result;
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(
        `Failed to upsert household member for applicationId=${applicationId}: ${err.message}`,
        err.stack,
      );
      throw new InternalServerErrorException(
        'Could not create/update household member',
      );
    }
  }

  // list all household members for an applicationID
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

  // used when a household member is removed by the front end
  // e.g. the applicant removes a household member that may have been saved
  //
  async remove(householdMemberId: string): Promise<boolean> {
    try {
      this.logger.log(
        `Attempting to delete household member with ID: ${householdMemberId}`,
      );

      const result = await this.householdMemberModel
        .findOneAndDelete({ householdMemberId })
        .exec();

      if (!result) {
        this.logger.warn(
          `Household Member with ID ${householdMemberId} not found`,
        );
        throw new NotFoundException(
          `Household Member with ID ${householdMemberId} not found`,
        );
      }

      this.logger.log(
        `Successfully deleted household member with ID: ${householdMemberId}`,
      );
      return true;
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      const err = error as Error;
      this.logger.error(
        `Failed to delete household member ${householdMemberId}: ${err.message}`,
        err.stack,
      );
      throw new InternalServerErrorException(
        'Could not delete household member',
      );
    }
  }

  // used by the dev util for clearing out the data
  async deleteAllMembersByApplicationId(
    applicationId: string,
  ): Promise<{ deletedCount: number }> {
    try {
      this.logger.log(
        `Deleting all household members for applicationId: ${applicationId}`,
      );

      const result = await this.householdMemberModel
        .deleteMany({ applicationId })
        .exec();

      this.logger.log(
        `Deleted ${result.deletedCount} household members for applicationId: ${applicationId}`,
      );

      return { deletedCount: result.deletedCount };
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(
        `Failed to delete household members for applicationId=${applicationId}: ${err.message}`,
        err.stack,
      );
      throw new InternalServerErrorException(
        'Could not delete household members',
      );
    }
  }

  // used by household invitation process, when we attempt to lookup a household member and don't have a user record yet.
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
