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
import {
  ApplicationPackageStatus,
  ServiceRequestStage,
} from './enums/application-package-status.enum';
import { ApplicationForm } from '../application-form/schemas/application-form.schema';
import { ApplicationFormService } from '../application-form/services/application-form.service';
import {
  ApplicationFormType,
  getFormIdForFormType,
} from '../application-form/enums/application-form-types.enum';
import { CreateApplicationPackageDto } from './dto/create-application-package.dto';
import { UpdateApplicationPackageDto } from './dto/update-application-package.dto';
import { CancelApplicationPackageDto } from './dto/cancel-application-package.dto';
import { HouseholdService } from '../household/household.service';
import { AccessCodeService } from '../application-form/services/access-code.service';
import { UserService } from '../auth/user.service';
import { UserUtil } from '../common/utils/user.util';
import { calculateAge } from '../common/utils/age.util';
import { Model } from 'mongoose';
import { RelationshipToPrimary } from '../household/enums/relationship-to-primary.enum';
import { SiebelApiService } from '../siebel/siebel-api.service';
//import { ReferralState } from './enums/application-package-subtypes.enum';
import { ValidateHouseholdCompletionDto } from './dto/validate-application-package.dto';

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
    private readonly applicationFormService: ApplicationFormService,
    private readonly accessCodeService: AccessCodeService,
    private readonly householdService: HouseholdService,
    private readonly userService: UserService,
    private readonly siebelApiService: SiebelApiService,
    private readonly userUtil: UserUtil,
    @InjectPinoLogger(ApplicationFormService.name)
    private readonly logger: PinoLogger,
  ) {}

  // create a new application package, which includes creating the initial referral form
  // and the primary household member
  // returns the created application package
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

  // cancel an application package, which includes deleting all associated forms,
  // household members, and access codes
  // only allowed if the package is in DRAFT or IN_PROGRESS status
  async cancelApplicationPackage(
    dto: CancelApplicationPackageDto,
  ): Promise<void> {
    try {
      // Delete all application forms for this package
      await this.applicationFormService.deleteByApplicationPackageId(
        dto.applicationPackageId,
      );

      // Delete all screening access codes associated with this package
      await this.accessCodeService.deleteByApplicationPackageId(
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

  async updateApplicationPackage(
    applicationPackageId: string,
    dto: UpdateApplicationPackageDto,
    userId: string,
  ): Promise<ApplicationPackage> {
    try {
      const updatedPackage = await this.applicationPackageModel
        .findOneAndUpdate(
          {
            applicationPackageId: { $eq: applicationPackageId },
            userId: { $eq: userId },
          },
          { $set: dto },
          { new: true, runValidators: true },
        )
        .exec();
      if (!updatedPackage) {
        throw new NotFoundException(
          `Application package with ID ${applicationPackageId} not found or access denied`,
        );
      }

      this.logger.info(
        { applicationPackageId, userId },
        'Application package updated successfully',
      );

      return updatedPackage;
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(
        `Failed to update application package ${applicationPackageId}: ${err.message}`,
        err.stack,
      );
      throw new InternalServerErrorException(
        'Could not update application package',
      );
    }
  }

  // get the applicationPackage details for a given packageId and userId
  // used to view the package details and status
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

  async updateApplicationPackageStage(
    applicationPackage: ApplicationPackage,
    newStage: ServiceRequestStage,
  ): Promise<ApplicationPackage> {
    try {
      this.logger.info(
        { applicationPackage, newStage },
        'Updating application package stage',
      );

      // TODO: compare against previous stage to ensure valid transition
      // TODO: handle withdrawl, cancellations, etc.
      if (newStage === ServiceRequestStage.APPLICATION) {
        // create aboutme as the first application Form
        const aboutMeDto = {
          applicationPackageId: applicationPackage.applicationPackageId,
          formId: getFormIdForFormType(ApplicationFormType.ABOUTME),
          userId: applicationPackage.userId,
          type: ApplicationFormType.ABOUTME,
          formParameters: {},
        };
        await this.applicationFormService.createApplicationForm(aboutMeDto);

        // note, household is handled differently from the other forms;
        // we use the applicationForm table to track the status of the household data,
        // but there is no actual form to fill out; the data is collected
        // via the household API endpoints
        const householdDto = {
          applicationPackageId: applicationPackage.applicationPackageId,
          formId: getFormIdForFormType(ApplicationFormType.HOUSEHOLD),
          userId: applicationPackage.userId,
          type: ApplicationFormType.HOUSEHOLD,
          formParameters: {},
        };
        await this.applicationFormService.createApplicationForm(householdDto);
      }

      const updatedPackage = await this.applicationPackageModel
        .findOneAndUpdate(
          { applicationPackageId: applicationPackage.applicationPackageId },
          {
            srStage: newStage,
            status: ApplicationPackageStatus.APPLICATION,
            updatedAt: new Date(),
          },
          { new: true },
        )
        .lean()
        .exec();

      if (!updatedPackage) {
        throw new NotFoundException('Application package not found');
      }

      this.logger.info(
        {
          applicationPackageId: applicationPackage.applicationPackageId,
          newStage,
        },
        'Application package stage updated successfully',
      );

      return updatedPackage;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(
        {
          error,
          applicationPackageId: applicationPackage.applicationPackageId,
          newStage,
        },
        'Failed to update application package stage',
      );
      throw new InternalServerErrorException(
        'Failed to update application package stage',
      );
    }
  }

  // get all application packages for a user
  // used on dashboard to list all packages for possible interaction
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

      const forms = await this.applicationFormService.findShortByPackageAndUser(
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

      // TODO
      // if there is a service request ID already, it means that the service request exists in ICM
      // therefore, we will only need to update the prospects
      // and upload the attached forms
      // but we need to check that everyone is complete first; household members may still need to
      // finish their consent forms.

      const isInitialSubmission = !applicationPackage.srId?.trim();

      // get the primary user
      const primaryUser = await this.userService.findOne(userId);

      let serviceRequestId: string;

      if (isInitialSubmission) {
        // create the service request
        const srPayload = {
          Id: 'NULL',
          Status: 'Open',
          Priority: '3-Standard',
          Type: 'Caregiver Application',
          'SR Sub Type': applicationPackage.subtype,
          'SR Sub Sub Type': applicationPackage.subsubtype,
          'ICM Stage': 'Application',
          'ICM BCSC DID': primaryUser.bc_services_card_id,
          'Service Office': 'MCFD',
          'Comm Method': 'Client Portal',
          Memo: 'Created By Portal',
        };

        const siebelResponse =
          await this.siebelApiService.createServiceRequest(srPayload);

        if (!siebelResponse) {
          throw new InternalServerErrorException(
            'Failed to create service request',
          );
        }

        const newServiceRequestId = (
          siebelResponse as SiebelServiceRequestResponse
        ).items?.Id;

        if (!newServiceRequestId) {
          this.logger.error(
            { siebelResponse },
            'No service request ID in response',
          );
          throw new InternalServerErrorException(
            'Failed to get service request ID from Siebel',
          );
        }
        serviceRequestId = newServiceRequestId;

        this.logger.info(
          { applicationPackageId, serviceRequestId },
          'Created new service request in Siebel',
        );
      } else {
        // not the initial submission so let's reuse the service request ID
        serviceRequestId = applicationPackage.srId?.trim();
      }

      // the referral stage has not been implemented in ICM yet; on creation
      // of a service request, it will default to Application, which will actually
      // be the second step in the process. We will create a seperate endpoint
      // to track the status and stage.
      //const serviceRequestStage = (
      //  siebelResponse as SiebelServiceRequestResponse
      //).items?.['ICM Stage'] as string;

      if (isInitialSubmission) {
        // for the initial submission, we create the user payload
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
      } else {
        // on the subsequent submission, we will create payloads for every other user
        // load household
        const allHouseholdMembers =
          await this.householdService.findAllHouseholdMembers(
            applicationPackageId,
          );
        // filter out the primary applicant (they were created on the initial submission)
        const nonPrimaryHouseholdMembers = allHouseholdMembers.filter(
          (member) =>
            member.relationshipToPrimary != RelationshipToPrimary.Self,
        );

        this.logger.info(
          {
            applicationPackageId,
            totalMembers: allHouseholdMembers.length,
            nonPrimaryHouseholdMembers: nonPrimaryHouseholdMembers.length,
          },
          'Processing household members for subsequent submission',
        );
        // process each non-primary household member
        for (const householdMember of nonPrimaryHouseholdMembers) {
          try {
            let prospectPayload;

            // if they have a userId, it means they have logged in via BC Services card and we have their info in the user record
            if (householdMember.userId) {
              // adult household member with their own user account
              const memberUser = await this.userService.findOne(
                householdMember.userId,
              );
              prospectPayload = {
                ServiceRequestId: serviceRequestId, //TODO
                IcmBcscDid: memberUser.bc_services_card_id,
                FirstName: memberUser.first_name,
                LastName: memberUser.last_name,
                DateofBirth: memberUser.dateOfBirth,
                StreetAddress: memberUser.street_address,
                City: memberUser.city,
                Prov: memberUser.region,
                PostalCode: memberUser.postal_code,
                EmailAddress: memberUser.email,
                Gender: this.userUtil.sexToGenderType(memberUser.sex),
                Relationship: householdMember.relationshipToPrimary,
              };
            } else {
              // household member without user account (typically minors)
              prospectPayload = {
                ServiceRequestId: serviceRequestId, //TODO
                IcmBcscDid: '',
                FirstName: householdMember.firstName,
                LastName: householdMember.lastName,
                DateofBirth: householdMember.dateOfBirth,
                StreetAddress: primaryUser.street_address,
                City: primaryUser.city,
                Prov: primaryUser.region,
                PostalCode: primaryUser.postal_code,
                EmailAddress: '', //householdMember.email,
                Gender: householdMember.genderType,
                Relationship: householdMember.relationshipToPrimary,
              };
            }

            const memberProspectResponse =
              await this.siebelApiService.createProspect(prospectPayload);

            this.logger.info(
              {
                householdMember: householdMember.householdMemberId,
                prospectId: (memberProspectResponse as { Id: string }).Id, // should we save the prospectID??
                relationship: householdMember.relationshipToPrimary,
              },
              'Created prospect for household member',
            );
          } catch (error) {
            this.logger.error(
              {
                error,
                householdMemberId: householdMember.householdMemberId,
                relationship: householdMember.relationshipToPrimary,
              },
              'Failed to create prospect for household member',
            );
            // continue processing other members even if one fails..??
          }
        }
      }

      // get all application forms for this package
      const allApplicationForms =
        await this.applicationFormService.findByPackageAndUser(
          applicationPackageId,
          userId,
        );

      // attach the forms
      // for an initial submission, there should only be a referral form
      let formsToAttach;

      if (isInitialSubmission) {
        formsToAttach = allApplicationForms.filter(
          (form) => form.type === ApplicationFormType.REFERRAL,
        );
        this.logger.info(
          {
            applicationPackageId,
            totalForms: allApplicationForms.length,
            referralForms: formsToAttach.length,
          },
          'Initial submission: attaching only REFERRAL forms',
        );
      } else {
        // For subsequent submissions, attach everything EXCEPT REFERRAL forms
        formsToAttach = allApplicationForms.filter(
          (form) => form.type !== ApplicationFormType.REFERRAL,
        );
        this.logger.info(
          {
            applicationPackageId,
            totalForms: allApplicationForms.length,
            nonReferralForms: formsToAttach.length,
          },
          'Subsequent submission: attaching non-REFERRAL forms',
        );
      }

      const attachmentResults = [];
      for (const form of formsToAttach) {
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
          totalForms: formsToAttach.length,
          successfulAttachments: attachmentResults.length,
        },
        `Completed attachment creation for ${attachmentResults.length}/${formsToAttach.length} forms`,
      );

      // After the attachment loop, add this check:
      if (attachmentResults.length !== formsToAttach.length) {
        const failedCount = formsToAttach.length - attachmentResults.length;
        this.logger.warn(
          {
            applicationPackageId,
            expectedAttachments: formsToAttach.length,
            successfulAttachments: attachmentResults.length,
            failedAttachments: failedCount,
          },
          'Some forms failed to attach to Siebel - submission continuing with partial attachments',
        );
      }

      await this.applicationPackageModel.findOneAndUpdate(
        { applicationPackageId },
        {
          status: isInitialSubmission
            ? ApplicationPackageStatus.REFERRAL
            : ApplicationPackageStatus.SUBMITTED,
          //referralstate: ReferralState.REQUESTED,
          submittedAt: new Date(),
          updatedAt: new Date(),
          srId: serviceRequestId,
          // srStage: serviceRequestStage,
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

  async lockApplicationPackage(
    applicationPackageId: string,
    userId: string,
  ): Promise<{ status: ApplicationPackageStatus }> {
    try {
      this.logger.info(
        { applicationPackageId, userId },
        'locking application package validation and processing',
      );

      // Verify ownership
      const applicationPackage = await this.applicationPackageModel
        .findOne({ applicationPackageId, userId })
        .lean();

      if (!applicationPackage) {
        throw new NotFoundException(
          `Application package ${applicationPackageId} not found or not owned by user`,
        );
      }
      // validate household completion
      const householdValidation =
        await this.householdService.validateHouseholdCompletion(
          applicationPackageId,
          applicationPackage.hasPartner,
          applicationPackage.hasHousehold,
        );
      if (!householdValidation.isComplete) {
        //household data is incomplete
        throw new BadRequestException( // TODO: what is the right ERROR??
          `Household data is incomplete`,
        );
      }

      // check if there are non-self household members who are adults (require screenings)
      const allHouseholdMembers =
        await this.householdService.findAllHouseholdMembers(
          applicationPackageId,
        );
      const nonSelfAdultMembers = allHouseholdMembers.filter((member) => {
        if (member.relationshipToPrimary === RelationshipToPrimary.Self) {
          return false;
        }
        // calculate age to determine if they're an adult
        const age = calculateAge(member.dateOfBirth);
        return age >= 19; // adults require screening
      });

      const requiresHouseholdScreening =
        (applicationPackage.hasPartner === 'true' ||
          applicationPackage.hasHousehold === 'true') &&
        nonSelfAdultMembers.length > 0;

      if (requiresHouseholdScreening) {
        // household is complete, and adults must complete screening
        await this.applicationPackageModel.findOneAndUpdate(
          { applicationPackageId },
          {
            status: ApplicationPackageStatus.AWAITING,
            updatedAt: new Date(),
          },
        );
        return {
          status: ApplicationPackageStatus.AWAITING,
        };
      } else {
        // everything is ready - proceed for final submission
        const submissionResult = await this.submitApplicationPackage(
          applicationPackageId,
          userId,
        );

        this.logger.info(
          {
            applicationPackageId,
            serviceRequestId: submissionResult.serviceRequestId,
          },
          'Application validation complete - automatically submitted',
        );

        return {
          status: ApplicationPackageStatus.SUBMITTED,
        };
      }
    } catch (error) {
      this.logger.error(
        { error, applicationPackageId, userId },
        'Failed to validate and process application',
      );
      throw error;
    }
  }

  async validateHouseholdCompletion(
    applicationPackageId: string,
    userId: string,
  ): Promise<ValidateHouseholdCompletionDto> {
    // First, verify the user owns this application package
    const applicationPackage = await this.applicationPackageModel
      .findOne({ applicationPackageId, userId })
      .lean();

    if (!applicationPackage) {
      throw new NotFoundException(
        `Application package ${applicationPackageId} not found or not owned by user`,
      );
    }

    // Call the household service validation method
    return await this.householdService.validateHouseholdCompletion(
      applicationPackageId,
      applicationPackage.hasPartner,
      applicationPackage.hasHousehold,
    );
  }
}
