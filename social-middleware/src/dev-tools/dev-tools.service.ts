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
} from '../application/schemas/form-parameters.schema';
import { HouseholdService } from '../household/household.service';

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
        { applicationId: 1 },
      );

      const applicationFormIds = applicationForms.map(
        (form) => form.applicationId,
      );

      this.logger.info(
        { userId, formCount: applicationFormIds.length },
        '[DevTools] Found application forms',
      );

      // step 3: delete form parameters associated with application forms
      const deletedFormParameters = await this.formParametersModel.deleteMany({
        applicationId: { $in: applicationFormIds },
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
}
