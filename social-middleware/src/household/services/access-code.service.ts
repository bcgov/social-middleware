import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import {
  ScreeningAccessCode,
  ScreeningAccessCodeDocument,
} from '../schemas/screening-access-code.schema';
import {
  ApplicationForm,
  ApplicationFormDocument,
} from '../../application-form/schemas/application-form.schema';
import { HouseholdService } from './household.service';
import { PinoLogger } from 'nestjs-pino';
import { AccessCodeType } from '../enums/access-code-type.enum';
import {
  ApplicationPackage,
  ApplicationPackageDocument,
} from 'src/application-package/schema/application-package.schema';

@Injectable()
export class AccessCodeService {
  constructor(
    @InjectModel(ScreeningAccessCode.name)
    private readonly screeningAccessCodeModel: Model<ScreeningAccessCodeDocument>,
    @InjectModel(ApplicationPackage.name)
    private readonly applicationPackageModel: Model<ApplicationPackageDocument>,
    @InjectModel(ApplicationForm.name)
    private readonly applicationFormModel: Model<ApplicationFormDocument>,
    private readonly householdService: HouseholdService,
    private readonly logger: PinoLogger,
  ) {}

  // service to create an access code record
  async createAccessCode(
    householdMemberId: string,
    applicationPackageId?: string,
    type: AccessCodeType = AccessCodeType.SCREENING,
  ): Promise<{
    accessCode: string;
    expiresAt: Date;
  }> {
    const accessCode = this.generateAccessCode();

    const EXPIRY_HOURS: Record<AccessCodeType, number> = {
      [AccessCodeType.SCREENING]: 72,
      [AccessCodeType.NEW_APPLICATION]: 336, // 14 days
    };
    const expiresAt = new Date(
      Date.now() + EXPIRY_HOURS[type] * 60 * 60 * 1000,
    );

    try {
      // create screening application record
      this.logger.info('Creating new Access Code Record');

      const accessCodeRecord = new this.screeningAccessCodeModel({
        accessCode,
        applicationPackageId,
        type,
        householdMemberId,
        isUsed: false,
        expiresAt,
        attemptCount: 0,
        maxAttempts: 3,
      });

      await accessCodeRecord.save();
      this.logger.info(
        { accessCode, expiresAt },
        'Created screening access code record',
      );

      return { accessCode, expiresAt };
    } catch (error) {
      this.logger.error({ error }, 'Failed to create access code record');
      throw new InternalServerErrorException('Access code creation failed');
    }
  }

  /**
   * Generate a 6 digit secure access code
   */
  generateAccessCode(length = 6): string {
    // note we remove ambiguous characters like I, 1, O, 0
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Associate a user with an access code
   */
  async associateUserWithAccessCode(
    accessCode: string,
    userId: string,
    bcscUserData: {
      lastName: string;
      dateOfBirth: string;
      email?: string;
      firstName?: string;
      sex?: string;
    },
  ): Promise<{
    success: boolean;
    type?: AccessCodeType;
    error?: string;
    householdMemberId?: string | null; //
    applicationPackageId?: string; // returned for NEW_APPLICATION
  }> {
    try {
      // locate a valid access code record with the accessCode provided
      const accessCodeRecord = await this.screeningAccessCodeModel.findOne({
        accessCode,
        isUsed: false,
        expiresAt: { $gt: new Date() },
        attemptCount: { $lt: 5 },
      });

      // if we didn't find a valid one return an error
      if (!accessCodeRecord) {
        this.logger.warn(
          { accessCode },
          'Invalid, expired, or locked access code',
        );
        return { success: false, error: 'Invalid or expired access code' };
      }

      //  let's find the householdMember for associated with the access code
      const householdMember = await this.householdService.findById(
        accessCodeRecord.householdMemberId,
      );

      // if we don't find one, that's an error
      if (!householdMember) {
        this.logger.error(
          { householdMemberId: accessCodeRecord.householdMemberId },
          'Household member not found',
        );
        return { success: false, error: 'No match' };
      }

      // now let's see if the last name on the household record matches the BC services Card Data
      const lastNameMatch =
        bcscUserData.lastName.toLowerCase().trim() ===
        householdMember.lastName.toLowerCase().trim();
      // let's check the date of birth
      const dobMatch = this.compareDates(
        bcscUserData.dateOfBirth,
        householdMember.dateOfBirth,
      );

      // if either don't match, then this access code isn't for them (or whoever generated it made a mistake)
      if (!lastNameMatch || !dobMatch) {
        await this.screeningAccessCodeModel.findByIdAndUpdate(
          accessCodeRecord._id,
          {
            $inc: { attemptCount: 1 },
          },
        );

        this.logger.warn(
          {
            accessCode,
            userId,
            expectedLastName: householdMember.lastName.toLowerCase().trim(),
            providedLastName: bcscUserData.lastName.toLowerCase().trim(),
            expectedDOB: householdMember.dateOfBirth,
            providedDOB: bcscUserData.dateOfBirth,
            attemptCount: accessCodeRecord.attemptCount + 1,
          },
          'User validation failed for access code',
        );

        return {
          success: false,
          error: 'Personal information does not match.',
        };
      }

      // we got this far, which means we found a match, so let's link the access code to the user record
      await this.screeningAccessCodeModel.findByIdAndUpdate(
        accessCodeRecord._id,
        {
          assignedUserId: userId,
          isUsed: true,
        },
      );

      // now let's link the household record to the user
      await this.householdService.associateUserWithMember(
        accessCodeRecord.householdMemberId,
        userId,
      );

      // if it's a new application, let's associate the application package with the userId
      if (accessCodeRecord.type === AccessCodeType.NEW_APPLICATION) {
        await this.applicationPackageModel.updateOne(
          { applicationPackageId: accessCodeRecord.applicationPackageId },
          { userId: userId },
        );
        return {
          success: true,
          type: AccessCodeType.NEW_APPLICATION,
          applicationPackageId: accessCodeRecord.applicationPackageId,
        };
      }

      // if we got this far, we're doing a SCREENING
      // and we can update the household record details with the bcsc data;
      // the first name from BCSC may be different from what the primary applicant provided

      await this.householdService.updateMemberWithUserData(
        accessCodeRecord.householdMemberId,
        {
          firstName: bcscUserData.firstName,
          sex: bcscUserData.sex,
        },
      );

      // associate all application forms for this household member with the user
      await this.applicationFormModel.updateMany(
        { householdMemberId: accessCodeRecord.householdMemberId },
        { userId: userId },
      );

      this.logger.info(
        {
          householdMemberId: accessCodeRecord.householdMemberId,
          userId,
        },
        'Associated application forms with authenticated user',
      );

      // all good to go
      this.logger.info(
        {
          accessCode,
          userId,
          householdMemberId: accessCodeRecord.householdMemberId,
        },
        'Successfully validated and associated user with screening application',
      );

      return {
        success: true,
        householdMemberId: accessCodeRecord.householdMemberId,
      };
    } catch (error: unknown) {
      this.logger.error(
        { error, accessCode, userId },
        'Failed to associate user with access code',
      );
      throw new InternalServerErrorException('Failed to process access code');
    }
  }

  async getLatestAccessCode(householdMemberId: string): Promise<{
    accessCode: string;
    expiresAt: Date;
    isUsed: boolean;
    attemptCount: number;
  } | null> {
    try {
      this.logger.debug(
        { householdMemberId },
        'Fetching latest access code for household member',
      );

      const accessCodeRecord = await this.screeningAccessCodeModel
        .findOne({ householdMemberId })
        .sort({ createdAt: -1 })
        .lean()
        .exec();

      if (!accessCodeRecord) {
        this.logger.info(
          { householdMemberId },
          'No access code found for household member',
        );
        return null;
      }

      return {
        accessCode: accessCodeRecord.accessCode,
        expiresAt: accessCodeRecord.expiresAt,
        isUsed: accessCodeRecord.isUsed,
        attemptCount: accessCodeRecord.attemptCount,
      };
    } catch (error) {
      this.logger.error(
        { error, householdMemberId },
        'Failed to fetch access code',
      );
      throw new InternalServerErrorException('Failed to fetch access code');
    }
  }

  // get the latest access code if it is valid, otherwise create a new one.
  async resendOrCreateAccessCode(
    householdMemberId: string,
    applicationPackageId?: string,
    type: AccessCodeType = AccessCodeType.SCREENING,
  ): Promise<{ accessCode: string; expiresAt: Date; isNew: boolean }> {
    // check to see if we have an access code for this householdMember
    const existing = await this.getLatestAccessCode(householdMemberId);
    // if it exists and is valid
    if (
      existing &&
      !existing.isUsed &&
      existing.expiresAt > new Date() &&
      existing.attemptCount < 5
    ) {
      // return it
      return {
        accessCode: existing.accessCode,
        expiresAt: existing.expiresAt,
        isNew: false,
      };
    }
    //otherwise create a new one
    const created = await this.createAccessCode(
      householdMemberId,
      applicationPackageId,
      type,
    );
    return { ...created, isNew: true };
  }

  // helper method to compare BCSC DOB to ISO DOB (which ICM prefers)
  private compareDates(date1: string, date2: string): boolean {
    try {
      const d1 = new Date(date1);
      const d2 = new Date(date2);

      // Check if both dates are valid
      if (isNaN(d1.getTime()) || isNaN(d2.getTime())) {
        this.logger.error({ date1, date2 }, 'Invalid dates provided');
        return false;
      }

      // Compare only the date parts using UTC to avoid timezone issues
      const d1Year = d1.getUTCFullYear();
      const d1Month = d1.getUTCMonth();
      const d1Day = d1.getUTCDate();

      const d2Year = d2.getUTCFullYear();
      const d2Month = d2.getUTCMonth();
      const d2Day = d2.getUTCDate();

      this.logger.info(
        {
          original1: date1,
          original2: date2,
          d1Parts: { year: d1Year, month: d1Month, day: d1Day },
          d2Parts: { year: d2Year, month: d2Month, day: d2Day },
        },
        `Comparing date parts`,
      );

      return d1Year === d2Year && d1Month === d2Month && d1Day === d2Day;
    } catch (error) {
      this.logger.error({ date1, date2, error }, 'Date comparison failed');
      return false;
    }
  }

  // delete screening access codes related to a given applicationPackageID
  async deleteByApplicationPackageId(
    applicationPackageId: string,
  ): Promise<void> {
    await this.screeningAccessCodeModel
      .deleteMany({ applicationPackageId: applicationPackageId })
      .exec();
  }
}
