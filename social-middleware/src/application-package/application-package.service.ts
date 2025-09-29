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
import { ApplicationFormService } from '../application-form/application-form.service';
import { ApplicationFormType } from '../application-form/enums/application-form-types.enum';
import { CreateApplicationPackageDto } from './dto/create-application-package.dto';
import { CancelApplicationPackageDto } from './dto/cancel-application-package.dto';
//import { HouseholdMembers } from '../household/schemas/household-members.schema';
import { HouseholdService } from '../household/household.service';
import { UserService } from '../auth/user.service';
import { UserUtil } from '../common/utils/user.util';
import { Model } from 'mongoose';
import { RelationshipToPrimary } from '../household/enums/relationship-to-primary.enum';
import { SiebelApiService } from '../siebel/siebel-api.service';
import { ReferralState } from './enums/application-package-subtypes.enum';

interface SiebelServiceRequestResponse {
  items?: {
    Id?: string;
    [key: string]: unknown;
  };
}

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
    private readonly siebelApiService: SiebelApiService,
    private readonly userUtil: UserUtil,
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
      formId: 'CF0001_Referral', // TODO: Make data driven
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
      genderType: this.userUtil.sexToGenderType(user.sex),
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
  async getApplicationPackage(
    applicationPackageId: string,
    userId: string,
  ): Promise<ApplicationPackage> {
    try {
      this.logger.info(
        { applicationPackageId, userId },
        'Fetching application package',
      );

      const applicationPackage = await this.applicationPackageModel
        .findOne({
          applicationPackageId: { $eq: applicationPackageId },
          userId: { $eq: userId },
        })
        .lean()
        .exec();

      if (!applicationPackage) {
        throw new NotFoundException(
          'Application package not found or access denied',
        );
      }

      this.logger.info(
        { applicationPackageId, userId },
        'Application package fetched successfully',
      );

      return applicationPackage;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(
        { error, applicationPackageId, userId },
        'Failed to fetch application package',
      );
      throw new InternalServerErrorException(
        'Failed to fetch application package',
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

      // create the service request
      const srPayload = {
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

      const siebelResponse =
        await this.siebelApiService.createServiceRequest(srPayload);

      if (!siebelResponse) {
        throw new InternalServerErrorException();
      }

      const serviceRequestId = (siebelResponse as SiebelServiceRequestResponse)
        .items?.Id;

      if (!serviceRequestId) {
        this.logger.error(
          { siebelResponse },
          'No service request ID in response.',
        );
        throw new InternalServerErrorException(
          'Failed to get service request Id',
        );
      }

      const primaryUserProspectPayload = {
        ServiceRequestId: serviceRequestId, //TODO
        IcmBcscDid: primaryUser.bc_services_card_id,
        FirstName: primaryUser.first_name,
        LastName: primaryUser.last_name,
        DateofBirth: primaryUser.dateOfBirth,
        StreetAddress: primaryUser.street_address,
        City: primaryUser.city,
        Prov: primaryUser.region,
        PostalCode: primaryUser.postal_code,
        EmailAddress: primaryUser.email,
        Gender: this.userUtil.sexToGenderType(primaryUser.sex),
        Relationship: 'Key player',
      };

      const siebelProspectResponse =
        (await this.siebelApiService.createProspect(
          primaryUserProspectPayload,
        )) as { Id: string };

      if (!siebelProspectResponse.Id) {
        console.log('failed to create prospect');
      }

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
              (await this.siebelApiService.createAttachment(serviceRequestId, {
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
                serviceRequestId: serviceRequestId,
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
              serviceRequestId: serviceRequestId,
            },
            'Failed to create attachment for form',
          );
        }
      }

      this.logger.info(
        {
          serviceRequestId: serviceRequestId,
          totalForms: applicationForms.length,
          successfulAttachments: attachmentResults.length,
        },
        'Completed attachment creation for all forms',
      );

      await this.applicationPackageModel.findOneAndUpdate(
        { applicationPackageId },
        {
          status: ApplicationPackageStatus.SUBMITTED,
          referralstate: ReferralState.REQUESTED,
          submittedAt: new Date(),
          srId: serviceRequestId,
        },
      );

      this.logger.info(
        {
          applicationPackageId,
          serviceRequestId: serviceRequestId,
        },
        'Application package submitted successfully to Siebel',
      );

      return {
        serviceRequestId: serviceRequestId,
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
