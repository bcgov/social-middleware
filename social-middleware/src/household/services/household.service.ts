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
} from '../schemas/household-members.schema';
import { CreateHouseholdMemberDto } from '../dto/create-household-member.dto';
import { RelationshipToPrimary } from '../enums/relationship-to-primary.enum';
import { MemberTypes } from '../enums/member-types.enum';
import { v4 as uuidv4 } from 'uuid';
import { sexToGenderType } from '../../common/utils/gender.util';
import {
  ApplicationPackage,
  ApplicationPackageDocument,
} from '../../application-package/schema/application-package.schema';

@Injectable()
export class HouseholdService {
  private readonly logger = new Logger(HouseholdService.name);

  constructor(
    @InjectModel(HouseholdMembers.name)
    private householdMemberModel: Model<HouseholdMembersDocument>,
    @InjectModel(ApplicationPackage.name)
    private applicationPackageModel: Model<ApplicationPackageDocument>,
  ) {}

  // TO DO: Move to UTIL function
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

      // check for duplicates before creating/updating
      const duplicateCheck = await this.checkForDuplicate(
        dto.applicationPackageId,
        dto.firstName,
        dto.lastName,
        dto.dateOfBirth,
        householdMemberId,
      );

      if (duplicateCheck.isDuplicate) {
        //const existing = duplicateCheck.existingMember!;
        throw new InternalServerErrorException(
          'A household member with the same name and date of birth already exists in this application.',
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

  /**
   * updateHouseholdMember
   * updates a household member record with update data
   * @param householdMemberId
   * @param updateData
   * @returns HouseholdMember
   */
  async updateHouseholdMember(
    householdMemberId: string,
    updateData: Partial<HouseholdMembers>,
  ): Promise<HouseholdMembersDocument> {
    const updated = await this.householdMemberModel
      .findOneAndUpdate({ householdMemberId }, updateData, { new: true })
      .exec();
    if (!updated) {
      throw new NotFoundException('Household member not found');
    }
    return updated;
  }

  // update household member details with authenticated user information
  async updateMemberWithUserData(
    householdMemberId: string,
    userData: {
      firstName?: string;
      sex?: string;
    },
  ): Promise<HouseholdMembersDocument> {
    try {
      this.logger.log(
        `Updating household member ${householdMemberId} with authenticated user data`,
      );

      const updateData: Partial<HouseholdMembers> = {};

      // update firstName if provided
      if (userData.firstName) {
        updateData.firstName = userData.firstName;
      }
      if (userData.sex) {
        updateData.genderType = sexToGenderType(userData.sex);
      }

      return this.updateHouseholdMember(householdMemberId, updateData);
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(
        `Failed to update household member ${householdMemberId}: ${err.message}`,
        err.stack,
      );
      throw new InternalServerErrorException(
        'Could not update household member with user data',
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

  async findByUserId(userId: string): Promise<HouseholdMembersDocument[]> {
    try {
      const members = await this.householdMemberModel.find({ userId }).exec();

      this.logger.log(
        `Found ${members.length} household members for userId:${userId}`,
      );

      return members;
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(
        `Error finding household members for userId=${userId}: ${err.message}`,
        err.stack,
      );
      throw new InternalServerErrorException(
        'Failed to find household members by userId',
      );
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

  async findPrimaryApplicant(
    applicationPackageId: string,
  ): Promise<HouseholdMembersDocument | null> {
    return await this.householdMemberModel
      .findOne({ applicationPackageId })
      .sort({ createdAt: 1 }) // Get the first one created
      .exec();
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

  // used by the dev util for resetting application package - deletes all except primary applicant
  async deleteNonPrimaryMembersByApplicationPackageId(
    applicationPackageId: string,
  ): Promise<{ deletedCount: number }> {
    try {
      this.logger.log(
        `Deleting non-primary household members for applicationPackageId: ${applicationPackageId}`,
      );

      const result = await this.householdMemberModel
        .deleteMany({
          applicationPackageId,
          relationshipToPrimary: { $ne: 'Self' },
        })
        .exec();

      this.logger.log(
        `Deleted ${result.deletedCount} non-primary household members for applicationPackageId: ${applicationPackageId}`,
      );

      return { deletedCount: result.deletedCount };
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(
        `Failed to delete non-primary household members for applicationPackageId=${applicationPackageId}: ${err.message}`,
        err.stack,
      );
      throw new InternalServerErrorException(
        'Could not delete non-primary household members',
      );
    }
  }

  async markScreeningProvided(householdMemberId: string): Promise<void> {
    await this.householdMemberModel
      .findOneAndUpdate(
        { householdMemberId },
        { $set: { screeningInfoProvided: true } },
      )
      .exec();
  }

  async validateHouseholdCompletion(
    applicationPackageId: string,
    hasPartner: string,
    hasHousehold: string,
  ): Promise<{
    isComplete: boolean;
    errors: string[];
    summary: {
      partnersRequired: number;
      partnersFound: number;
      householdMembersRequired: boolean;
      householdMembersFound: number;
      incompleteRecords: string[];
    };
  }> {
    const errors: string[] = [];
    const incompleteRecords: string[] = [];

    // get all household members for this application package
    const householdMembers = await this.householdMemberModel
      .find({ applicationPackageId })
      .lean();

    // helper function to check if a household member record is complete
    // TODO: handle email & gender checking if situations require.
    const isRecordComplete = (member: HouseholdMembers): boolean => {
      const hasValue = (value: any) =>
        value != null && value !== undefined && value !== '';

      return (
        hasValue(member.firstName) &&
        hasValue(member.lastName) &&
        hasValue(member.dateOfBirth) &&
        hasValue(member.relationshipToPrimary)
      );
    };

    const partnersRequired = hasPartner === 'true' ? 1 : 0;

    const partnerTypes = [
      RelationshipToPrimary.Spouse,
      RelationshipToPrimary.Partner,
      RelationshipToPrimary.CommonLaw,
    ];

    const partners = householdMembers.filter((member) =>
      partnerTypes.includes(member.relationshipToPrimary),
    );

    const partnersFound = partners.length;

    if (partnersRequired) {
      if (partnersFound === 0) {
        errors.push(
          'Partner is required but no spouse/partner/common-law record found',
        );
      } else if (partnersFound > 1) {
        errors.push(`Only 1 partner record allowed, found ${partnersFound}`);
      } else {
        // check if partner record is complete
        const partner = partners[0];
        if (!isRecordComplete(partner)) {
          incompleteRecords.push(
            `Partner/spouse: ${partner.firstName} ${partner.lastName}`,
          );
          errors.push('Partner record is incomplete');
        }
      }
    } else {
      if (partnersFound > 0) {
        errors.push('Partner data is corrupted');
      }
    }

    const householdMembersRequired = hasHousehold === 'true' ? true : false;

    const nonSpouseNonSelfMembers = householdMembers.filter(
      (member) =>
        member.relationshipToPrimary !== RelationshipToPrimary.Self &&
        member.relationshipToPrimary !== RelationshipToPrimary.Spouse &&
        member.relationshipToPrimary !== RelationshipToPrimary.Partner &&
        member.relationshipToPrimary !== RelationshipToPrimary.CommonLaw,
    );

    const householdMembersFound = nonSpouseNonSelfMembers.length;

    if (householdMembersRequired) {
      if (householdMembersFound === 0) {
        errors.push('Household members are required but none were found');
      } else {
        // check if all household member records are complete
        for (const member of nonSpouseNonSelfMembers) {
          if (!isRecordComplete(member)) {
            incompleteRecords.push(
              `${member.relationshipToPrimary}: ${member.firstName} ${member.lastName}`,
            );
            errors.push(
              `Household member record incomplete: ${member.firstName} ${member.lastName}`,
            );
          }
        }
      }
    } else {
      if (householdMembersFound > 0) {
        errors.push('Household data is corrupted');
      }
    }

    const isComplete =
      !!hasPartner?.trim() && !!hasHousehold?.trim() && errors.length === 0;

    return {
      isComplete: isComplete,
      errors: errors,
      summary: {
        partnersRequired: partnersRequired,
        partnersFound: partnersFound,
        householdMembersRequired: householdMembersRequired,
        householdMembersFound: householdMembersFound,
        incompleteRecords: incompleteRecords,
      },
    };
  }

  /**
   * Check if a household member with similar identifying information already exists
   * Matches on: lastname, dateOfBirth, and first initial of firstName
   */

  async checkForDuplicate(
    applicationPackageId: string,
    firstName: string,
    lastName: string,
    dateOfBirth: string,
    excludeHouseholdMemberId?: string,
  ): Promise<{
    isDuplicate: boolean;
    existingMember?: HouseholdMembersDocument;
  }> {
    try {
      const firstInitial = firstName.charAt(0).toUpperCase();

      // find all members for this application package
      const members = await this.householdMemberModel
        .find({ applicationPackageId })
        .lean()
        .exec();

      // check for duplicates
      for (const member of members) {
        // skip of this is the same record being updated
        if (
          excludeHouseholdMemberId &&
          member.householdMemberId === excludeHouseholdMemberId
        ) {
          continue;
        }

        // match criteria: same last name, DOB, and first initial
        const memberFirstInitial = member.firstName.charAt(0).toUpperCase();
        const lastNameMatch =
          member.lastName.toLowerCase().trim() ===
          lastName.toLowerCase().trim();
        const dobMatch = member.dateOfBirth === dateOfBirth;
        const firstInitialMatch = memberFirstInitial === firstInitial;

        if (lastNameMatch && dobMatch && firstInitialMatch) {
          this.logger.warn(
            {
              applicationPackageId,
              firstName,
              lastName,
              dateOfBirth,
              existingMember: member.householdMemberId,
            },
            'Duplicate household member detected',
          );

          return {
            isDuplicate: true,
            existingMember: member as HouseholdMembersDocument,
          };
        }
      }
      return { isDuplicate: false };
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(
        `Error checking for duplicate household member: ${err.message}`,
        err.stack,
      );
      throw new InternalServerErrorException(
        'Could not check for duplicate household members',
      );
    }
  }

  async verifyUserOwnsHouseholdMemberPackage(
    householdMemberId: string,
    userId: string,
  ): Promise<boolean> {
    try {
      const member = await this.findById(householdMemberId);

      if (!member) {
        this.logger.warn({ householdMemberId }, 'Household member not found');
        return false;
      }

      // Check if user owns the application package
      const appPackage = await this.applicationPackageModel
        .findOne({
          applicationPackageId: member.applicationPackageId,
          userId: userId,
        })
        .lean()
        .exec();

      return !!appPackage;
    } catch (error) {
      this.logger.error(
        { error, householdMemberId, userId },
        'Error verifying household member package ownership',
      );
      return false;
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
