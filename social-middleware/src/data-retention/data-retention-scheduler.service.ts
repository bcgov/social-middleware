import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  FormParameters,
  FormParametersDocument,
} from '../application-form/schemas/form-parameters.schema';
import {
  ScreeningAccessCode,
  ScreeningAccessCodeDocument,
} from '../household/schemas/screening-access-code.schema';
import {
  ApplicationPackage,
  ApplicationPackageDocument,
} from 'src/application-package/schema/application-package.schema';
import {
  HouseholdMembers,
  HouseholdMembersDocument,
} from 'src/household/schemas/household-members.schema';
import {
  ApplicationForm,
  ApplicationFormDocument,
} from 'src/application-form/schemas/application-form.schema';
import {
  Attachment,
  AttachmentDocument,
} from 'src/attachments/schemas/attachment.schema';
import { ServiceRequestStage } from 'src/application-package/enums/application-package-status.enum';

import { RETENTION_SCHEDULE } from './retention-schedule.config';

@Injectable()
export class DataRetentionSchedulerService {
  private readonly modelMap: Record<string, Model<any>>;
  constructor(
    @InjectPinoLogger(DataRetentionSchedulerService.name)
    private readonly logger: PinoLogger,
    @InjectModel(FormParameters.name)
    private readonly formParametersModel: Model<FormParametersDocument>,
    @InjectModel(ScreeningAccessCode.name)
    private readonly screeningAccessCodeModel: Model<ScreeningAccessCodeDocument>,
    @InjectModel(ApplicationPackage.name)
    private readonly applicationPackageModel: Model<ApplicationPackageDocument>,
    @InjectModel(HouseholdMembers.name)
    private readonly householdMembersModel: Model<HouseholdMembersDocument>,
    @InjectModel(ApplicationForm.name)
    private readonly applicationFormModel: Model<ApplicationFormDocument>,
    @InjectModel(Attachment.name)
    private readonly attachmentModel: Model<AttachmentDocument>,
  ) {
    this.modelMap = {
      FormParameters: this.formParametersModel,
      ScreeningAccessCode: this.screeningAccessCodeModel,
    };
  }

  @Cron(CronExpression.EVERY_HOUR)
  async purgeStaleRecords() {
    for (const rule of RETENTION_SCHEDULE) {
      const model = this.modelMap[rule.name];
      if (!model) {
        this.logger.warn(
          { rule: rule.name },
          'No model registered for retention rule',
        );
        continue;
      }

      const cutoff = new Date(Date.now() - rule.maxAgeHours * 60 * 60 * 1000);
      const result = await model.deleteMany({
        createdAt: { $lt: cutoff },
        ...rule.filter,
      });

      if (result.deletedCount > 0) {
        this.logger.info(
          { collection: rule.name, deletedCount: result.deletedCount, cutoff },
          'Data retention purge complete',
        );
      }
    }
  }
  @Cron(CronExpression.EVERY_HOUR)
  async purgeCompletedPackages() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const completedPackages = await this.applicationPackageModel
      .find({
        srStage: ServiceRequestStage.COMPLETED,
        updatedAt: { $lt: cutoff },
      })
      .select('applicationPackageId')
      .limit(100)
      .lean();

    if (completedPackages.length === 0) return;

    const packageIds = completedPackages.map((p) => p.applicationPackageId);

    const [forms, members, accessCodes, attachments, packages] =
      await Promise.all([
        this.applicationFormModel.deleteMany({
          applicationPackageId: { $in: packageIds },
        }),
        this.householdMembersModel.deleteMany({
          applicationPackageId: { $in: packageIds },
        }),
        this.screeningAccessCodeModel.deleteMany({
          applicationPackageId: { $in: packageIds },
        }),
        this.attachmentModel.deleteMany({
          applicationPackageId: { $in: packageIds },
        }),
        this.applicationPackageModel.deleteMany({
          applicationPackageId: { $in: packageIds },
        }),
      ]);

    if (packages.deletedCount > 0) {
      this.logger.info(
        {
          packageCount: packages.deletedCount,
          formCount: forms.deletedCount,
          memberCount: members.deletedCount,
          accessCodeCount: accessCodes.deletedCount,
          attachmentCount: attachments.deletedCount,
          cutoff,
        },
        'Completed package cascade purge complete',
      );
    }
  }
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async purgeAbandonedPackages() {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 6);

    const stalePackages = await this.applicationPackageModel
      .find({
        $or: [{ srId: { $exists: false } }, { srId: null }, { srId: '' }],
        createdAt: { $lt: cutoff },
      })
      .select('applicationPackageId')
      .limit(100)
      .lean();

    if (stalePackages.length === 0) return;

    const packageIds = stalePackages.map((p) => p.applicationPackageId);

    const [forms, members, accessCodes, packages] = await Promise.all([
      this.applicationFormModel.deleteMany({
        applicationPackageId: { $in: packageIds },
      }),
      this.householdMembersModel.deleteMany({
        applicationPackageId: { $in: packageIds },
      }),
      this.screeningAccessCodeModel.deleteMany({
        applicationPackageId: { $in: packageIds },
      }),
      this.applicationPackageModel.deleteMany({
        applicationPackageId: { $in: packageIds },
      }),
    ]);

    this.logger.info(
      {
        packageCount: packages.deletedCount,
        formCount: forms.deletedCount,
        memberCount: members.deletedCount,
        accessCodeCount: accessCodes.deletedCount,
        cutoff,
      },
      'Abandoned package cascade purge complete',
    );
  }
}
