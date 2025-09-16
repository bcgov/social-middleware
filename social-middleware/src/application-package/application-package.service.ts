// application-submission.service.ts

import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { v4 as uuidv4 } from 'uuid';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ApplicationPackage } from './schema/application-package.schema';
import { ApplicationPackageStatus } from './enums/application-package-status.enum';
//import { ApplicationForm } from '../application-form/schemas/application-form.schema';
import { ApplicationFormService } from '../application-form/application-form.service';
import { ApplicationFormType } from '../application-form/enums/application-form-types.enum';
import { CreateApplicationPackageDto } from './dto/create-application-package.dto';
import { CancelApplicationPackageDto } from './dto/cancel-application-package.dto';
//import { HouseholdMembers } from '../household/schemas/household-members.schema';
import { HouseholdService } from '../household/household.service';
import { UserService } from '../auth/user.service';
import { GenderTypes } from '../household/enums/gender-types.enum';
import { Model } from 'mongoose';
import { RelationshipToPrimary } from '../household/enums/relationship-to-primary.enum';

@Injectable()
export class ApplicationPackageService {
  constructor(
    @InjectModel(ApplicationPackage.name)
    private applicationPackageModel: Model<ApplicationPackage>,
    //@InjectModel(ApplicationForm.name)
    //private applicationFormModel: Model<ApplicationForm>,
    private readonly applicationFormService: ApplicationFormService,
    //private householdModel: Model<HouseholdMembers>,
    private readonly householdService: HouseholdService,
    private readonly userService: UserService,
    @InjectPinoLogger(ApplicationFormService.name)
    private readonly logger: PinoLogger,
  ) {}
  async createApplicationPackage(
    dto: CreateApplicationPackageDto,
  ): Promise<ApplicationPackage> {
    this.logger.info(
      {
        userId: dto.userId,
        subtype: dto.subtype,
        subsubtype: dto.subsubtype,
      },
      'Starting Application with DTO',
    );

    const initialPackage = new this.applicationPackageModel({
      applicationPackageId: uuidv4(),
      userId: dto.userId,
      subtype: dto.subtype,
      subsubtype: dto.subsubtype,
      status: ApplicationPackageStatus.DRAFT,
    });

    const appPackage = await initialPackage.save();

    // create referral as the first application Form
    const referralDto = {
      applicationPackageId: appPackage.applicationPackageId,
      formId: 'CF0001', // TODO: Make data driven
      userId: dto.userId,
      type: ApplicationFormType.REFERRAL,
      formParameters: {},
    };

    const referral =
      await this.applicationFormService.createApplicationForm(referralDto);

    // the primary applicant is the first household member
    const user = await this.userService.findOne(dto.userId);

    const primaryHouseholdMemberDto = {
      applicationPackageId: appPackage.applicationPackageId,
      userId: dto.userId,
      firstName: user.first_name,
      lastName: user.last_name,
      dateOfBirth: user.dateOfBirth,
      email: user.email,
      relationshipToPrimary: RelationshipToPrimary.Self,
      genderType: this.sexToGenderType(user.sex),
    };

    await this.householdService.createMember(primaryHouseholdMemberDto);

    this.logger.info(
      {
        applicationPackageId: appPackage.applicationPackageId,
        referralApplicationId: referral.applicationId,
      },
      'Created referral form for application package',
    );
    return appPackage;
  }

  //TODO: Move to a Util function
  private sexToGenderType(sex: string): GenderTypes {
    switch (sex.toLowerCase()) {
      case 'male':
        return GenderTypes.ManBoy;
      case 'female':
        return GenderTypes.WomanGirl;
      case 'non-binary':
        return GenderTypes.NonBinary;
      default:
        return GenderTypes.Unspecified;
    }
  }

  async cancelApplicationPackage(
    dto: CancelApplicationPackageDto,
  ): Promise<void> {
    try {
      // Delete all application forms for this package
      await this.applicationFormService.deleteByApplicationPackageId(
        dto.applicationPackageId,
      );

      // Delete all household members for this package
      await this.householdService.deleteAllMembersByApplicationPackageId(
        dto.applicationPackageId,
      );

      // find and delete the application package
      const appPackage = await this.applicationPackageModel
        .findOneAndDelete({
          userId: { $eq: dto.userId },
          applicationPackageId: { $eq: dto.applicationPackageId },
        })
        .exec();

      if (!appPackage) {
        throw new NotFoundException(
          'Application package not found or access denied',
        );
      }
      this.logger.info(
        { applicationPackageId: dto.applicationPackageId, userId: dto.userId },
        'Application package cancelled successfully',
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error; // Re-throw NotFoundException
      }

      this.logger.error(
        {
          error,
          applicationPackageId: dto.applicationPackageId,
          userId: dto.userId,
        },
        'Failed to cancel application package',
      );
      throw new InternalServerErrorException(
        'Failed to cancel application package',
      );
    }
  }

  async getApplicationPackages(userId: string): Promise<ApplicationPackage[]> {
    try {
      this.logger.info({ userId }, 'Fetching application packages for user');

      const applicationPackages = await this.applicationPackageModel
        .find({ userId: { $eq: userId } })
        .sort({ createdAt: -1 }) // most recent first
        .lean()
        .exec();

      this.logger.info(
        { userId, count: applicationPackages.length },
        `Application packages fetched successfully`,
      );

      return applicationPackages;
    } catch (error) {
      this.logger.error(
        { error, userId },
        'Failed to fetch application packages',
      );
      throw new InternalServerErrorException(
        'Failed to fetch application packages',
      );
    }
  }

  /*
  async updateSubmissionStatus(
    applicationId: string,
    updateDto: UpdateSubmissionStatusDto,
  ): Promise<ApplicationSubmission> {
    // verify ownership before proceeding
*/
  /*
    const application = await this.applicationService.findByIdAndUser(
      applicationId,
      userId,
    );

    if (!application) {
      throw new NotFoundException(`Application not found.`);
    } */
  /*
    const submission = await this.applicationSubmissionModel.findOneAndUpdate(
      { applicationId },
      {
        ...updateDto,
        updatedAt: new Date(),
      },
      { new: true, runValidators: true },
    );

    if (!submission) {
      throw new NotFoundException(
        `Submission not found for application ID: ${applicationId}`,
      );
    }

    //if (application.userId !== submission.userId) {

    return submission;
  }

*/
}
