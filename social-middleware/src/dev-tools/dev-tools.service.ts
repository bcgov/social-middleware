// dev-tools/dev-tools.service.ts
import {
  Injectable,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../auth/schemas/user.schema';
import {
  Application,
  ApplicationDocument,
} from '../application/schemas/application.schema';
import {
  FormParameters,
  FormParametersDocument,
} from '../application/schemas/form-parameters.schema';
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

      const deletedUser = await this.userModel.deleteMany({
        _id: { $eq: userId },
      });

      const deletedApps = await this.applicationModel.deleteMany({
        primary_applicantId: { $eq: userId },
      });

      const deletedFormParams = await this.formParametersModel.deleteMany({
        applicationId: { $in: applicationIds },
      });

      this.logger.warn(
        {
          userId,
          deletedUsers: deletedUser.deletedCount,
          deletedApplications: deletedApps.deletedCount,
          deletedFormParameters: deletedFormParams.deletedCount,
        },
        '[DevTools] Deletion complete',
      );

      return {
        message: `Deleted user ${deletedUser.deletedCount}, Deleted ${deletedApps.deletedCount} applications, ${deletedFormParams.deletedCount} form parameters`,
      };
    } catch (error) {
      this.logger.error({ error, userId }, 'Error in [DevTools] clearUserData');
      throw new InternalServerErrorException('Failed to clear user data');
    }
  }
}
