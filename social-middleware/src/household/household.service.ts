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
import { RelationshipToPrimary } from './enums/relationship-to-primary.enum';
import { MemberTypes } from './enums/member-types.enum';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class HouseholdService {
  private readonly logger = new Logger(HouseholdService.name);

  constructor(
    @InjectModel(HouseholdMembers.name)
    private householdMemberModel: Model<HouseholdMembersDocument>,
  ) {}

  // helper method to make some decisions off of
  private calculateAge(dateOfBirth: string): number {
    const today = new Date();
    const birthDate = new Date(dateOfBirth);
    let age = today.getFullYear() - birthDate.getFullYear();

    const monthDifference = today.getMonth() - birthDate.getMonth();
    // if their birthday is after the current month
    // or if the day of their birthday is later this month
    // then we need to subtract a year from their calculated age
    if (
      monthDifference < 0 ||
      (monthDifference === 0 && today.getDate() < birthDate.getDate())
    ) {
      age--;
    }
    return age;
  }

  // create a household member
  async createMember(
    //applicationId: string,
    dto: CreateHouseholdMemberDto,
  ): Promise<HouseholdMembersDocument> {
    try {
      let householdMemberId;
      const { householdMemberId: tempId, ...memberData } = dto;
      householdMemberId = tempId;

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

      const age = this.calculateAge(dto.dateOfBirth);
      this.logger.log(`Age is ${age}`);
      // everyone over 19 requires a screening
      const requireScreening = age >= 19;
      this.logger.log(`requiresScreening is: ${requireScreening}`);
      let memberType = null;

      switch (dto.relationshipToPrimary) {
        case RelationshipToPrimary.Self:
          memberType = MemberTypes.Primary;
          break;
        case RelationshipToPrimary.Spouse:
          memberType = MemberTypes.PrimaryNonApplicant;
          break;
        case RelationshipToPrimary.Partner:
          memberType = MemberTypes.PrimaryNonApplicant;
          break;
        default:
          if (requireScreening) {
            memberType = MemberTypes.NonCaregiverAdult;
          } else {
            memberType = MemberTypes.NonAdult;
          }
          break;
      }

      const result = await this.householdMemberModel
        .findOneAndUpdate(
          {
            householdMemberId: householdMemberId,
            applicationPackageId: dto.applicationPackageId,
          },
          {
            $set: {
              ...memberData,
              householdMemberId,
              applicationPackageId: dto.applicationPackageId,
              requireScreening,
              memberType,
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
        `Successfully upserted household member with ID: ${result.householdMemberId} for applicationPackageId: ${dto.applicationPackageId}`,
      );
      return result;
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(
        `Failed to upsert household member for applicationPackageId=${dto.applicationPackageId}: ${err.message}`,
        err.stack,
      );
      throw new InternalServerErrorException(
        'Could not create/update household member',
      );
    }
  }

  // associate a userID with a householdMemberID; used when a household member successfully uses an access code
  async associateUserWithMember(
    householdMemberId: string,
    userId: string,
  ): Promise<HouseholdMembersDocument | null> {
    try {
      this.logger.log(
        `Associating user ${userId} with household member ${householdMemberId}`,
      );

      const result = await this.householdMemberModel
        .findOneAndUpdate(
          { householdMemberId },
          { userId: userId },
          { new: true }, // return the updated document
        )
        .exec();

      if (!result) {
        this.logger.warn(
          `Household member with ID ${householdMemberId} not found for user association.`,
        );
        return null;
      }

      this.logger.log(
        `Successfully associated user ${userId} with household member ${householdMemberId}`,
      );
      return result;
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(
        `Failed to associate ${userId} with household member ${householdMemberId}: ${err.message}`,
        err.stack,
      );
      throw new InternalServerErrorException(
        'Could not associate user with household member',
      );
    }
  }

  async findById(
    householdMemberId: string,
  ): Promise<HouseholdMembersDocument | null> {
    try {
      const member = await this.householdMemberModel
        .findOne({ householdMemberId })
        .exec();

      if (!member) {
        this.logger.warn(
          `Household member with ID ${householdMemberId} not found`,
        );
        return null;
      }

      return member;
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(
        `Error finding household member with ID=${householdMemberId}: ${err.message}`,
        err.stack,
      );
      throw new InternalServerErrorException('Failed to find household member');
    }
  }

  // list all household members for an applicationID
  async findAllHouseholdMembers(
    applicationPackageId: string,
  ): Promise<HouseholdMembersDocument[]> {
    try {
      const members = await this.householdMemberModel
        .find({ applicationPackageId })
        .exec();
      return members;
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(
        `Error fetching household members for applicationId=${applicationPackageId}: ${err.message}`,
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
  async deleteAllMembersByApplicationPackageId(
    applicationPackageId: string,
  ): Promise<{ deletedCount: number }> {
    try {
      this.logger.log(
        `Deleting all household members for applicationPackageId: ${applicationPackageId}`,
      );

      const result = await this.householdMemberModel
        .deleteMany({ applicationPackageId })
        .exec();

      this.logger.log(
        `Deleted ${result.deletedCount} household members for applicationPackageId: ${applicationPackageId}`,
      );

      return { deletedCount: result.deletedCount };
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(
        `Failed to delete household members for applicationPackageId=${applicationPackageId}: ${err.message}`,
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
