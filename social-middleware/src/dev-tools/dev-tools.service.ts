// dev-tools/dev-tools.service.ts
import {
  Injectable,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../auth/schemas/user.schema';

import { PinoLogger } from 'nestjs-pino';
import {
  ApplicationPackage,
  ApplicationPackageDocument,
} from '../application-package/schema/application-package.schema';
import {
  ApplicationForm,
  ApplicationFormDocument,
} from '../application-form/schemas/application-form.schema';
import {
  ScreeningAccessCode,
  ScreeningAccessCodeDocument,
} from '../application/schemas/screening-access-code.schema';
import {
  FormParameters,
  FormParametersDocument,
} from '../application-form/schemas/form-parameters.schema';
import { HouseholdService } from '../household/services/household.service';
import { ApplicationPackageStatus } from '../application-package/enums/application-package-status.enum';

@Injectable()
export class DevToolsService {
  constructor(
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    @InjectModel(ApplicationPackage.name)
    private applicationPackageModel: Model<ApplicationPackageDocument>,
    @InjectModel(ApplicationForm.name)
    private applicationFormModel: Model<ApplicationFormDocument>,
    @InjectModel(FormParameters.name)
    private formParametersModel: Model<FormParametersDocument>,
    @InjectModel(ScreeningAccessCode.name)
    private screeningAccessCodeModel: Model<ScreeningAccessCodeDocument>,
    private readonly householdService: HouseholdService,
    private readonly logger: PinoLogger,
  ) {}

  async clearUserData(userId: string): Promise<{ message: string }> {
    if (typeof userId !== 'string' || userId.trim() === '') {
      throw new BadRequestException('Invalid userId');
    }

    try {
      this.logger.warn({ userId }, '[DevTools] Deleting all data for user');

      // step 1: find all packages for the user
      const applicationPackages = await this.applicationPackageModel
        .find({ userId }, { applicationPackageId: 1 })
        .lean();

      const applicationPackageIds = applicationPackages.map(
        (pkg) => pkg.applicationPackageId,
      );

      this.logger.info(
        { userId, packageCount: applicationPackageIds.length },
        '[DevTools] found application packages',
      );

      // step 2: fin all application forms for these packages
      const applicationForms = await this.applicationFormModel.find(
        { applicationPackageId: { $in: applicationPackageIds } },
        { applicationFormId: 1 },
      );

      const applicationFormIds = applicationForms.map(
        (form) => form.applicationFormId,
      );

      this.logger.info(
        { userId, formCount: applicationFormIds.length },
        '[DevTools] Found application forms',
      );

      // step 3: delete form parameters associated with application forms
      const deletedFormParameters = await this.formParametersModel.deleteMany({
        applicationFormId: { $in: applicationFormIds },
      });

      // step 4: delete application forms associated with packages
      const deletedApplicationForms =
        await this.applicationFormModel.deleteMany({
          applicationPackageId: { $in: applicationPackageIds },
        });

      // Step 5: Delete screening access codes associated with application forms
      const deletedAccessCodes = await this.screeningAccessCodeModel.deleteMany(
        {
          parentApplicationId: { $in: applicationFormIds },
        },
      );

      // Step 6: Delete households associated with packages
      let totalDeletedHouseholdMembers = 0;
      for (const packageId of applicationPackageIds) {
        try {
          const result =
            await this.householdService.deleteAllMembersByApplicationPackageId(
              packageId,
            );
          totalDeletedHouseholdMembers += result.deletedCount || 0;
        } catch (error) {
          this.logger.warn(
            { packageId, error },
            `[DevTools] Failed to delete household members for packageId=${packageId}`,
          );
        }
      }

      // Step 7: Delete all application packages
      const deletedApplicationPackages =
        await this.applicationPackageModel.deleteMany({
          userId,
        });

      // Step 8: Delete user record
      const deletedUser = await this.userModel.deleteMany({
        _id: { $eq: userId },
      });

      this.logger.warn(
        {
          userId,
          deletedUsers: deletedUser.deletedCount,
          deletedApplicationPackages: deletedApplicationPackages.deletedCount,
          deletedApplicationForms: deletedApplicationForms.deletedCount,
          deletedFormParameters: deletedFormParameters.deletedCount,
          deletedAccessCodes: deletedAccessCodes.deletedCount,
          deletedHouseholdMembers: totalDeletedHouseholdMembers,
        },
        '[DevTools] Deletion complete',
      );

      return {
        message: `Deleted user ${deletedUser.deletedCount}, 
        ${deletedApplicationPackages.deletedCount} application packages, 
        ${deletedApplicationForms.deletedCount} application forms, ${deletedFormParameters.deletedCount} form
        parameters, ${deletedAccessCodes.deletedCount} access codes, and ${totalDeletedHouseholdMembers} 
        household members for userId ${userId}`,
      };
    } catch (error) {
      this.logger.error({ error, userId }, 'Error in [DevTools] clearUserData');
      throw new InternalServerErrorException('Failed to clear user data');
    }
  }

  async resetApplicationPackage(
    applicationPackageId: string,
  ): Promise<{ message: string }> {
    if (
      typeof applicationPackageId !== 'string' ||
      applicationPackageId.trim() === ''
    ) {
      throw new BadRequestException('Invalid applicationPackageId');
    }

    try {
      this.logger.warn(
        { applicationPackageId },
        '[DevTools] Resetting application package',
      );

      // Step 1: Find all application forms for this package
      const applicationForms = await this.applicationFormModel.find(
        { applicationPackageId },
        { applicationFormId: 1 },
      );

      const applicationFormIds = applicationForms.map(
        (form) => form.applicationFormId,
      );

      this.logger.info(
        { applicationPackageId, formCount: applicationFormIds.length },
        '[DevTools] Found application forms',
      );

      // Step 2: Delete form parameters associated with application forms
      const deletedFormParameters = await this.formParametersModel.deleteMany({
        applicationFormId: { $in: applicationFormIds },
      });

      // Step 3: Delete application forms
      const deletedApplicationForms =
        await this.applicationFormModel.deleteMany({
          applicationPackageId,
        });

      // Step 4: Delete screening access codes associated with application forms
      const deletedAccessCodes = await this.screeningAccessCodeModel.deleteMany(
        {
          parentApplicationId: { $in: applicationFormIds },
        },
      );

      // Step 5: Delete household members associated with package
      let deletedHouseholdMembers = 0;
      try {
        const result =
          await this.householdService.deleteNonPrimaryMembersByApplicationPackageId(
            applicationPackageId,
          );
        deletedHouseholdMembers = result.deletedCount || 0;
      } catch (error) {
        this.logger.warn(
          { applicationPackageId, error },
          `[DevTools] Failed to delete non-primary household members`,
        );
      }

      // Step 6: Reset the application package srStage to Referral
      const updatedPackage =
        await this.applicationPackageModel.findOneAndUpdate(
          { applicationPackageId },
          {
            $set: {
              srStage: 'Referral',
              status: ApplicationPackageStatus.REFERRAL,
              hasPartner: null,
              hasHousehold: null,
              hasSupportNetwork: null,
              hasMedicalAssessment: false,
            },
          },
          { new: true },
        );

      if (!updatedPackage) {
        throw new BadRequestException(
          `Application package ${applicationPackageId} not found`,
        );
      }

      this.logger.warn(
        {
          applicationPackageId,
          deletedApplicationForms: deletedApplicationForms.deletedCount,
          deletedFormParameters: deletedFormParameters.deletedCount,
          deletedAccessCodes: deletedAccessCodes.deletedCount,
          deletedHouseholdMembers,
        },
        '[DevTools] Reset complete',
      );

      return {
        message: `Reset application package ${applicationPackageId}: 
        deleted ${deletedApplicationForms.deletedCount} application forms, 
        ${deletedFormParameters.deletedCount} form parameters, 
        ${deletedAccessCodes.deletedCount} access codes, 
        ${deletedHouseholdMembers} household members, 
        and reset srStage to Referral`,
      };
    } catch (error) {
      this.logger.error(
        { error, applicationPackageId },
        'Error in [DevTools] resetApplicationPackage',
      );
      throw new InternalServerErrorException(
        'Failed to reset application package',
      );
    }
  }
}
