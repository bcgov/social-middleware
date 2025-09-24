// application-submission.service.ts

import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { v4 as uuidv4 } from 'uuid';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ApplicationPackage } from './schema/application-package.schema';
import { ApplicationPackageStatus } from './enums/application-package-status.enum';
import { ApplicationForm } from '../application-form/schemas/application-form.schema';
import { ApplicationFormService } from '../application-form/services/application-form.service';
import { ApplicationFormType } from '../application-form/enums/application-form-types.enum';
import { CreateApplicationPackageDto } from './dto/create-application-package.dto';
import { CancelApplicationPackageDto } from './dto/cancel-application-package.dto';
//import { HouseholdMembers } from '../household/schemas/household-members.schema';
import { HouseholdService } from '../household/household.service';
import { UserService } from '../auth/user.service';
import { GenderTypes } from '../household/enums/gender-types.enum';
import { Model } from 'mongoose';
import { RelationshipToPrimary } from '../household/enums/relationship-to-primary.enum';
import {
  ScreeningAccessCode,
  ScreeningAccessCodeDocument,
} from 'src/application-form/schemas/screening-access-code.schema';
import { SiebelApiService } from '../siebel/siebel-api.service';

@Injectable()
export class ApplicationPackageService {
  constructor(
    @InjectModel(ApplicationPackage.name)
    private applicationPackageModel: Model<ApplicationPackage>,

    @InjectModel(ScreeningAccessCode.name)
    private screeningAccessCodeModel: Model<ScreeningAccessCodeDocument>,
    //@InjectModel(ApplicationForm.name)
    //private applicationFormModel: Model<ApplicationForm>,
    private readonly applicationFormService: ApplicationFormService,
    //private householdModel: Model<HouseholdMembers>,
    private readonly householdService: HouseholdService,
    private readonly userService: UserService,
    private readonly siebelApiService: SiebelApiService,
    @InjectPinoLogger(ApplicationFormService.name)
    private readonly logger: PinoLogger,
  ) {}
  async createApplicationPackage(
    dto: CreateApplicationPackageDto,
    userId: string,
  ): Promise<ApplicationPackage> {
    this.logger.info(
      {
        userId: userId,
        subtype: dto.subtype,
        subsubtype: dto.subsubtype,
      },
      'Starting Application with DTO',
    );

    if (!userId) {
      throw new BadRequestException(`userId is not provided`);
    }

    const initialPackage = new this.applicationPackageModel({
      applicationPackageId: uuidv4(),
      userId: userId,
      subtype: dto.subtype,
      subsubtype: dto.subsubtype,
      status: ApplicationPackageStatus.DRAFT,
    });

    const appPackage = await initialPackage.save();

    // create referral as the first application Form
    const referralDto = {
      applicationPackageId: appPackage.applicationPackageId,
      formId: 'CF0001', // TODO: Make data driven
      userId: userId,
      type: ApplicationFormType.REFERRAL,
      formParameters: {},
    };

    const referral =
      await this.applicationFormService.createApplicationForm(referralDto);

    // the primary applicant is the first household member
    const user = await this.userService.findOne(userId);

    const primaryHouseholdMemberDto = {
      applicationPackageId: appPackage.applicationPackageId,
      userId: userId,
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

      // Delete all screening access codes associated with this package
      await this.screeningAccessCodeModel
        .deleteMany({ parentApplicationId: dto.applicationPackageId })
        .exec();

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

  async getApplicationFormsByPackageId(
    applicationPackageId: string,
    userId: string,
  ): Promise<ApplicationForm[]> {
    try {
      this.logger.info(
        { applicationPackageId, userId },
        'Fetching application forms for package',
      );

      const forms = await this.applicationFormService.findByPackageAndUser(
        applicationPackageId,
        userId,
      );

      this.logger.info(
        { applicationPackageId, userId, count: forms.length },
        'Application forms fetched successfully',
      );

      return forms;
    } catch (error) {
      this.logger.error(
        { error, applicationPackageId, userId },
        'Failed to fetch application forms',
      );
      throw new InternalServerErrorException(
        'Failed to fetch application forms',
      );
    }
  }

  async submitApplicationPackage(
    applicationPackageId: string,
    userId: string,
  ): Promise<{ serviceRequestId: string }> {
    try {
      this.logger.info(
        { applicationPackageId, userId },
        'Starting application package submission to Siebel',
      );

      // get the applicationPackage
      const applicationPackage = await this.applicationPackageModel
        .findOne({ applicationPackageId, userId })
        .lean()
        .exec();

      if (!applicationPackage) {
        throw new NotFoundException(
          'Application package not found or already submitted',
        );
      }
      // get all application forms for this package
      const applicationForms =
        await this.applicationFormService.findByPackageAndUser(
          applicationPackageId,
          userId,
        );

      // get the primary user
      const primaryUser = await this.userService.findOne(userId);

      // TODO: Get household

      const payload = {
        Id: 'NULL',
        Status: 'Open',
        Priority: '3-Standard',
        'Contact Method': 'Client Portal',
        Type: 'Caregiver Application',
        'Sub Type': applicationPackage.subtype,
        'Sub Sub Type': applicationPackage.subsubtype,
        'ICM Stage': 'Application',
        'Icm Bcsc Did': primaryUser.bc_services_card_id,
        'First Name': primaryUser.first_name,
        'Service Office': 'MCFD',
        'SR Memo': 'Created By Portal',
      };

      // create the service request
      const siebelResponse = (await this.siebelApiService.createServiceRequest(
        payload,
      )) as { Id: string };

      // attach the forms

      const attachmentResults = [];
      for (const form of applicationForms) {
        try {
          if (form.formData) {
            const fileName = form.type;
            const fileContent = Buffer.from(
              JSON.stringify(form.formData),
            ).toString('base64');
            const description = `Caregiver Application ${form.type} form`;

            const attachmentResult =
              (await this.siebelApiService.createAttachment(siebelResponse.Id, {
                fileName: fileName,
                fileContent: fileContent,
                fileType: 'json',
                description: description,
              })) as { Id: string };

            attachmentResults.push({
              applicationId: form.applicationId,
              attachmentId: attachmentResult.Id,
            });

            this.logger.info(
              {
                serviceRequestId: siebelResponse.Id,
                applicationId: form.applicationId,
                fileName: fileName,
              },
              'Attachment created successfully for form',
            );
          } else {
            this.logger.warn(
              { applicationId: form.applicationId },
              'Skipping form with no data for attachment',
            );
          }
        } catch (error) {
          this.logger.error(
            {
              error,
              applicationId: form.applicationId,
              serviceRequestId: siebelResponse.Id,
            },
            'Failed to create attachment for form',
          );
        }
      }

      this.logger.info(
        {
          serviceRequestId: siebelResponse.Id,
          totalForms: applicationForms.length,
          successfulAttachments: attachmentResults.length,
        },
        'Completed attachment creation for all forms',
      );

      await this.applicationPackageModel.findOneAndUpdate(
        { applicationPackageId },
        {
          status: ApplicationPackageStatus.SUBMITTED,
          submittedAt: new Date(),
          srId: siebelResponse.Id,
        },
      );

      this.logger.info(
        {
          applicationPackageId,
          serviceRequestId: siebelResponse.Id,
        },
        'Application package submitted successfully to Siebel',
      );

      return {
        serviceRequestId: siebelResponse.Id,
      };
    } catch (error) {
      this.logger.error(
        { error, applicationPackageId, userId },
        'Failed to submit application package to Siebel',
      );

      if (error instanceof NotFoundException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to submit application package',
      );
    }
  }
}
