import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ApplicationPackage } from '../schema/application-package.schema';
import { ApplicationPackageStatus } from '../enums/application-package-status.enum';
import { ApplicationPackageSubType } from '../enums/application-package-subtypes.enum';
import { HouseholdService } from '../../household/services/household.service';
import { ApplicationFormService } from '../../application-form/services/application-form.service';
import { UserService } from '../../auth/user.service';
import { User } from '../../auth/schemas/user.schema';
import { FORMS_WITH_DATABINDINGS } from '../../application-form/enums/application-form-types.enum';
import { ApplicationFormStatus } from '../../application-form/enums/application-form-status.enum';
import { GenderTypes } from '../../household/enums/gender-types.enum';

const SUPPORTED_STATUSES = [
  ApplicationPackageStatus.REFERRAL,
  ApplicationPackageStatus.APPLICATION,
];

@Injectable()
export class BcscSyncService {
  constructor(
    @InjectModel(ApplicationPackage.name)
    private readonly applicationPackageModel: Model<ApplicationPackage>,
    private readonly householdService: HouseholdService,
    private readonly applicationFormService: ApplicationFormService,
    private readonly userService: UserService,
    @InjectPinoLogger(BcscSyncService.name)
    private readonly logger: PinoLogger,
  ) {}

  async syncOnLogin(userId: string): Promise<void> {
    const user = await this.userService.findOne(userId);

    const packages = await this.applicationPackageModel
      .find({
        userId,
        status: {
          $in: [ApplicationPackageStatus.DRAFT, ...SUPPORTED_STATUSES],
        },
      })
      .lean()
      .exec();

    if (packages.length === 0) return;

    let setUpdatePending = false;

    for (const pkg of packages) {
      try {
        const result = await this.syncPackage(pkg, user);
        if (result.setUpdatePending) setUpdatePending = true;
      } catch (error) {
        this.logger.error(
          { error, applicationPackageId: pkg.applicationPackageId, userId },
          'Failed to sync BCSC data for application package',
        );
      }
    }

    if (setUpdatePending) {
      await this.userService.updateUser(userId, { bcsc_update_pending: true });
      this.logger.info(
        { userId },
        'Set bcsc_update_pending for foster application',
      );
    }
  }

  private async syncPackage(
    pkg: ApplicationPackage,
    user: User,
  ): Promise<{ setUpdatePending: boolean }> {
    const primaryApplicant = await this.householdService.findPrimaryApplicant(
      pkg.applicationPackageId,
    );

    if (!primaryApplicant || !pkg.userId) {
      this.logger.warn(
        { applicationPackageId: pkg.applicationPackageId },
        'No primary applicant found during BCSC sync — skipping',
      );
      return { setUpdatePending: false };
    }

    await this.householdService.updateHouseholdMember(
      primaryApplicant.householdMemberId,
      {
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        dateOfBirth: user.dateOfBirth,
        genderType: (user.sex as GenderTypes) || primaryApplicant.genderType,
      },
    );
    this.logger.info(
      { applicationPackageId: pkg.applicationPackageId },
      'Updated primary household member with new BCSC data',
    );

    if (!SUPPORTED_STATUSES.includes(pkg.status)) {
      return { setUpdatePending: false };
    }

    await this.resetDataBindingForms(pkg.applicationPackageId, pkg.userId);

    return { setUpdatePending: pkg.subtype === ApplicationPackageSubType.FCH };
  }

  private async resetDataBindingForms(
    applicationPackageId: string,
    userId: string,
  ): Promise<void> {
    const forms = await this.applicationFormService.findByPackageAndUser(
      applicationPackageId,
      userId,
    );

    const toReset = forms.filter(
      (form) =>
        FORMS_WITH_DATABINDINGS.includes(form.type) &&
        form.status !== ApplicationFormStatus.NEW,
    );

    for (const form of toReset) {
      await this.applicationFormService.updateFormStatus(
        form.applicationFormId,
        ApplicationFormStatus.NEW,
      );
    }

    if (toReset.length > 0) {
      this.logger.info(
        { applicationPackageId, resetCount: toReset.length },
        'Reset databinding forms to New due to BCSC data change',
      );
    }
  }
}
