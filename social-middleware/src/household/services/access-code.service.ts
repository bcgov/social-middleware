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

@Injectable()
export class AccessCodeService {
  constructor(
    @InjectModel(ScreeningAccessCode.name)
    private readonly screeningAccessCodeModel: Model<ScreeningAccessCodeDocument>,
    @InjectModel(ApplicationForm.name)
    private readonly applicationFormModel: Model<ApplicationFormDocument>,
    private readonly householdService: HouseholdService,
    private readonly logger: PinoLogger,
  ) {}

  // service to create an access code record
  async createAccessCode(
    applicationPackageId: string,
    applicationFormId: string,
    householdMemberId: string,
  ): Promise<{
    accessCode: string;
    expiresAt: Date;
  }> {
    const accessCode = this.generateAccessCode();
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours

    try {
      // create screening application record
      this.logger.info('Creating new Access Code Record');

      const accessCodeRecord = new this.screeningAccessCodeModel({
        accessCode,
        applicationPackageId,
        applicationFormId,
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
   * Generate a secure access code
   */
  generateAccessCode(length = 6): string {
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
    },
  ): Promise<{
    success: boolean;
    applicationFormId?: string;
    error?: string;
  }> {
    try {
      const accessCodeRecord = await this.screeningAccessCodeModel.findOne({
        accessCode,
        isUsed: false,
        expiresAt: { $gt: new Date() },
        attemptCount: { $lt: 3 },
      });

      if (!accessCodeRecord) {
        this.logger.warn(
          { accessCode },
          'Invalid, expired, or locked access code',
        );
        return { success: false, error: 'Invalid or expired access code' };
      }

      const householdMember = await this.householdService.findById(
        accessCodeRecord.householdMemberId,
      );

      if (!householdMember) {
        this.logger.error(
          { householdMemberId: accessCodeRecord.householdMemberId },
          'Household member not found',
        );
        return { success: false, error: 'No match' };
      }

      const lastNameMatch =
        bcscUserData.lastName.toLowerCase().trim() ===
        householdMember.lastName.toLowerCase().trim();
      const dobMatch = bcscUserData.dateOfBirth === householdMember.dateOfBirth;

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
            expectedLastName: householdMember.lastName,
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

      // validation successful
      await this.screeningAccessCodeModel.findByIdAndUpdate(
        accessCodeRecord._id,
        {
          assignedUserId: userId,
          isUsed: true,
        },
      );

      await this.applicationFormModel.findOneAndUpdate(
        { applicationId: accessCodeRecord.applicationFormId },
        { primary_applicantId: userId },
      );

      await this.householdService.associateUserWithMember(
        accessCodeRecord.householdMemberId,
        userId,
      );

      this.logger.info(
        {
          accessCode,
          userId,
          householdMemberId: accessCodeRecord.householdMemberId,
          applicationFormId: accessCodeRecord.applicationFormId,
        },
        'Successfully validated and associated user with screening application',
      );

      return {
        success: true,
        applicationFormId: accessCodeRecord.applicationFormId,
      };
    } catch (error) {
      this.logger.error(
        { error, accessCode, userId },
        'Failed to associate user with access code',
      );
      throw new InternalServerErrorException('Failed to process access code');
    }
  }
  async deleteByApplicationPackageId(
    applicationPackageId: string,
  ): Promise<void> {
    await this.screeningAccessCodeModel
      .deleteMany({ parentApplicationId: applicationPackageId })
      .exec();
  }
}
