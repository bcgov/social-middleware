// dev-tools/dev-tools.service.ts
import {
  Injectable,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../auth/schemas/user.schema';
import { HouseholdService } from '../household/household.service';
import {
  Application,
  ApplicationDocument,
} from '../application/schemas/application.schema';
import {
  FormParameters,
  FormParametersDocument,
} from '../application/schemas/form-parameters.schema';
import {
  ScreeningAccessCode,
  ScreeningAccessCodeDocument,
} from 'src/application/schemas/screening-access-code.schema';
import { PinoLogger } from 'nestjs-pino';

@Injectable()
export class DevToolsService {
  constructor(
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    @InjectModel(Application.name)
    private applicationModel: Model<ApplicationDocument>,
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

      const applications = await this.applicationModel
        .find({ primary_applicantId: { $eq: userId } }, { applicationId: 1 })
        .lean();

      const applicationIds = applications.map((app) => app.applicationId);

      let totalDeletedHouseholdMembers = 0;
      for (const appId of applicationIds) {
        try {
          const result =
            await this.householdService.deleteAllMembersByApplicationId(appId);
          totalDeletedHouseholdMembers += result.deletedCount || 0;
        } catch (error) {
          this.logger.warn(
            { appId, error },
            `[DevTools] Failed to delete household members for applicationId=${appId}`,
          );
        }
      }

      const deletedUser = await this.userModel.deleteMany({
        _id: { $eq: userId },
      });

      const deletedApps = await this.applicationModel.deleteMany({
        primary_applicantId: { $eq: userId },
      });

      const deletedFormParams = await this.formParametersModel.deleteMany({
        applicationId: { $in: applicationIds },
      });

      // delete screening access codes
      const deletedAccessCodes = await this.screeningAccessCodeModel.deleteMany(
        { parentApplicationId: { $in: applicationIds } },
      );

      // delete screening applications
      const deletedScreeningApps = await this.applicationModel.deleteMany({
        $or: [
          { parentApplicationId: { $in: applicationIds } },
          { parentApplicationId: { $eq: userId }, type: 'CaregiverScreening' },
        ],
      });

      this.logger.warn(
        {
          userId,
          deletedUsers: deletedUser.deletedCount,
          deletedApplications: deletedApps.deletedCount,
          deletedScreeningApps: deletedScreeningApps.deletedCount,
          deletedAccessCodes: deletedAccessCodes.deletedCount,
          deletedFormParameters: deletedFormParams.deletedCount,
        },
        '[DevTools] Deletion complete',
      );

      return {
        message: `Deleted user ${deletedUser.deletedCount}, ${deletedApps.deletedCount} applications, ${deletedScreeningApps.deletedCount} screening applications, ${deletedAccessCodes.deletedCount} access codes, ${deletedFormParams.deletedCount} form parameters, and ${totalDeletedHouseholdMembers} household members for userId ${userId}`,
      };
    } catch (error) {
      this.logger.error({ error, userId }, 'Error in [DevTools] clearUserData');
      throw new InternalServerErrorException('Failed to clear user data');
    }
  }
}
