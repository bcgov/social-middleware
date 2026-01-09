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
import { ApplicationPackageQueueService } from './queue/application-package-queue.service';
import { SubmitReferralRequestDto } from './dto/submit-referral-request.dto';
import { CreateApplicationPackageDto } from './dto/create-application-package.dto';
import { UpdateApplicationPackageDto } from './dto/update-application-package.dto';
import { CancelApplicationPackageDto } from './dto/cancel-application-package.dto';

import { HouseholdService } from '../household/services/household.service';
import { AccessCodeService } from '../household/services/access-code.service';
import { UserService } from '../auth/user.service';
import { ConfigService } from '@nestjs/config';
import { UserUtil } from '../common/utils/user.util';
import { calculateAge } from '../common/utils/age.util';
import { formatDateForSiebel } from '../common/utils/date.util';
import { Model } from 'mongoose';
import {
  getApplicantFlag,
  RelationshipToPrimary,
} from '../household/enums/relationship-to-primary.enum';
import { SiebelApiService } from '../siebel/siebel-api.service';
//import { ReferralState } from './enums/application-package-subtypes.enum';
import { ValidateHouseholdCompletionDto } from './dto/validate-application-package.dto';
//import { CreateApplicationFormDto } from '../application-form/dto/create-application-form.dto';
import { HouseholdMembersDocument } from '../household/schemas/household-members.schema';
import { ApplicationFormStatus } from '../application-form/enums/application-form-status.enum';
import { AttachmentsService } from '../attachments/attachments.service';
import { AttachmentType } from '../attachments/enums/attachment-types.enum';

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
    private readonly configService: ConfigService,
    private readonly siebelApiService: SiebelApiService,
    private readonly userUtil: UserUtil,
    private readonly applicationPackageQueueService: ApplicationPackageQueueService,
    private readonly attachmentsService: AttachmentsService,
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

    const primaryHouseholdMember = await this.householdService.createMember(
      primaryHouseholdMemberDto,
    );

    // create referral as the first application Form
    const referralDto = {
      applicationPackageId: appPackage.applicationPackageId,
      formId: getFormIdForFormType(ApplicationFormType.REFERRAL),
      userId: userId,
      householdMemberId: primaryHouseholdMember.householdMemberId,
      type: ApplicationFormType.REFERRAL,
      formParameters: {},
    };

    const referral =
      await this.applicationFormService.createApplicationForm(referralDto);

    this.logger.info(
      {
        applicationPackageId: appPackage.applicationPackageId,
        referralApplicationFormId: referral.applicationFormId,
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

      // TODO: handle withdrawl, cancellations, etc.
      // let newStatus: ApplicationPackageStatus;

      // Get the primary applicant's householdMemberId
      // At this point, the primary applicant should be the only household member
      const primaryApplicantMember =
        await this.householdService.findPrimaryApplicant(
          applicationPackage.applicationPackageId,
        );

      if (!primaryApplicantMember) {
        this.logger.error(
          { applicationPackageId: applicationPackage.applicationPackageId },
          'Primary applicant household member not found',
        );
        throw new InternalServerErrorException(
          'Primary applicant household member not found',
        );
      }

      if (
        newStage === ServiceRequestStage.APPLICATION &&
        applicationPackage.srStage !== ServiceRequestStage.APPLICATION // if we are already in Application, don't do anything
      ) {
        // create aboutme as the first application Form
        const aboutMeDto = {
          applicationPackageId: applicationPackage.applicationPackageId,
          formId: getFormIdForFormType(ApplicationFormType.ABOUTME),
          userId: applicationPackage.userId,
          householdMemberId: primaryApplicantMember.householdMemberId,
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
          householdMemberId: primaryApplicantMember.householdMemberId,
          type: ApplicationFormType.HOUSEHOLD,
          formParameters: {},
        };
        await this.applicationFormService.createApplicationForm(householdDto);

        // placements is the third form
        const placementDto = {
          applicationPackageId: applicationPackage.applicationPackageId,
          formId: getFormIdForFormType(ApplicationFormType.PLACEMENT),
          userId: applicationPackage.userId,
          householdMemberId: primaryApplicantMember.householdMemberId,
          type: ApplicationFormType.PLACEMENT,
          formParameters: {},
        };
        await this.applicationFormService.createApplicationForm(placementDto);

        // references is the fourth form
        const referencesDto = {
          applicationPackageId: applicationPackage.applicationPackageId,
          formId: getFormIdForFormType(ApplicationFormType.REFERENCES),
          userId: applicationPackage.userId,
          householdMemberId: primaryApplicantMember.householdMemberId,
          type: ApplicationFormType.REFERENCES,
          formParameters: {},
        };
        await this.applicationFormService.createApplicationForm(referencesDto);

        // consent is the final form
        const consentDto = {
          applicationPackageId: applicationPackage.applicationPackageId,
          formId: getFormIdForFormType(ApplicationFormType.CONSENT),
          userId: applicationPackage.userId,
          householdMemberId: primaryApplicantMember.householdMemberId,
          type: ApplicationFormType.CONSENT,
          formParameters: {},
        };
        await this.applicationFormService.createApplicationForm(consentDto);
      }

      const updateObject: Partial<ApplicationPackage> = {
        srStage: newStage,
        updatedAt: new Date(),
      };

      if (newStage === ServiceRequestStage.APPLICATION) {
        updateObject.status = ApplicationPackageStatus.APPLICATION;
      } else if (newStage === ServiceRequestStage.SCREENING) {
        updateObject.status = ApplicationPackageStatus.SUBMITTED;
      }

      const updatedPackage = await this.applicationPackageModel
        .findOneAndUpdate(
          { applicationPackageId: applicationPackage.applicationPackageId },
          updateObject,
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

  /** submitReferralRequest
   * Enables the primary applicant to request an information session
   * Creates a service request and prospect record for the primary applicant in ICM
   */

  async submitReferralRequest(
    applicationPackageId: string,
    userId: string,
    dto: SubmitReferralRequestDto,
  ): Promise<{ serviceRequestId: string }> {
    try {
      this.logger.info(
        { applicationPackageId, userId },
        'Starting referral request submission to Siebel',
      );
      // Get application package
      const applicationPackage = await this.applicationPackageModel
        .findOne({ applicationPackageId, userId })
        .lean()
        .exec();

      if (!applicationPackage) {
        throw new NotFoundException('Application package not found');
      }

      // Verify this is an initial submission (no existing srId)
      if (applicationPackage.srId?.trim()) {
        throw new BadRequestException(
          'Referral already submitted - should not be called',
        );
      }

      // Get primary user
      const primaryUser = await this.userService.findOne(userId);

      const updatedUser = await this.userService.update(userId, {
        email: dto.email,
        home_phone: dto.home_phone,
        alternate_phone: dto.alternate_phone,
      });

      // Create service request in Siebel
      const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
      const envSuffix = nodeEnv.toLowerCase().includes('prod') ? '' : nodeEnv; // say nothing in prod

      const srPayload = {
        Id: 'NULL',
        Status: 'Open',
        Priority: '3-Standard',
        Type: 'Caregiver Application',
        'SR Sub Type': applicationPackage.subtype,
        'SR Sub Sub Type': applicationPackage.subsubtype,
        'ICM Stage': ServiceRequestStage.REFERRAL, // create in the Referral Stage
        //'ICM Stage': ServiceRequestStage.APPLICATION, // create in the Referral Stage
        'ICM BCSC DID': updatedUser.bc_services_card_id,
        'Service Office': 'HUC', // needs to default to the HUC service office
        'Comm Method': 'Client Portal',
        Memo: `Created By ${envSuffix} Portal`,
      };

      const siebelResponse =
        await this.siebelApiService.createServiceRequest(srPayload);

      if (!siebelResponse) {
        throw new InternalServerErrorException(
          'Failed to create service request',
        );
      }

      const serviceRequestId = (siebelResponse as SiebelServiceRequestResponse)
        .items?.Id;

      if (!serviceRequestId) {
        this.logger.error(
          { siebelResponse },
          'No service request ID in response',
        );
        throw new InternalServerErrorException(
          'Failed to get service request ID from Siebel',
        );
      }
      // Create primary user prospect
      const primaryUserProspectPayload = {
        ServiceRequestId: serviceRequestId,
        IcmBcscDid: primaryUser.bc_services_card_id,
        FirstName: primaryUser.first_name,
        LastName: primaryUser.last_name,
        DateofBirth: formatDateForSiebel(primaryUser.dateOfBirth),
        StreetAddress: primaryUser.street_address,
        City: primaryUser.city,
        Prov: primaryUser.region,
        PostalCode: primaryUser.postal_code,
        EmailAddress: dto.email,
        HomePhone: dto.home_phone,
        AlternatePhone: dto.alternate_phone || '',
        Gender: this.userUtil.sexToGenderType(primaryUser.sex),
        Relationship: 'Key player',
        ApplicantFlag: 'Y',
      };

      const siebelProspectResponse =
        (await this.siebelApiService.createProspect(
          primaryUserProspectPayload,
        )) as { items?: { Id?: string } };

      this.logger.info(
        { siebelProspectResponse, responseType: typeof siebelProspectResponse },
        'Siebel prospect creation response received',
      );

      if (!siebelProspectResponse?.items?.Id) {
        this.logger.error('Failed to create prospect');
        throw new InternalServerErrorException('Failed to create prospect');
      }
      // Update application package status
      await this.applicationPackageModel.findOneAndUpdate(
        { applicationPackageId },
        {
          status: ApplicationPackageStatus.REFERRAL,
          submittedAt: new Date(),
          updatedAt: new Date(),
          srId: serviceRequestId,
        },
      );

      this.logger.info(
        { applicationPackageId, serviceRequestId },
        'Referral request submitted successfully to Siebel',
      );

      return { serviceRequestId };
    } catch (error) {
      this.logger.error(
        { error, applicationPackageId, userId },
        'Failed to submit referral request to Siebel',
      );

      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to submit referral request',
      );
    }
  }

  /** submitApplicationPackage
   * handles the final application-package submission from the portal
   * creates new prospect records for any household-members linked to the application
   * attaches forms foundry forms as attachments
   * uploads any attachments that have been provided in lieu of application-forms
   */

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
      const primaryApplicationPackage = await this.applicationPackageModel
        .findOne({ applicationPackageId, userId })
        .lean()
        .exec();

      let applicationPackage: ApplicationPackage;

      // if we found an applicationPackage for this user, then proceed
      if (primaryApplicationPackage) {
        applicationPackage = primaryApplicationPackage;
        this.logger.info('Primary Application package found for submission');
      } else {
        // otherwise, let's check if this was submitted by a household member who completed their screening form
        const screeningApplicationForm =
          await this.applicationFormService.findByPackageAndUser(
            applicationPackageId,
            userId,
          );
        // if we find a form
        if (
          screeningApplicationForm &&
          screeningApplicationForm.some(
            (form) => form.type === ApplicationFormType.SCREENING,
          )
        ) {
          // then we can proceed
          applicationPackage = (await this.applicationPackageModel
            .findOne({
              applicationPackageId,
            })
            .lean()
            .exec()) as ApplicationPackage;
          this.logger.info('Submission initiated via screening submission');
        } else {
          // otherwise, we throw not found
          throw new NotFoundException('Application package not found for user');
        }
      }

      const serviceRequestId = applicationPackage.srId?.trim();

      // if there is no service request id, we cannot continue
      if (serviceRequestId.length == 0) {
        throw new BadRequestException('No service request ID, cannot continue');
      }

      // load household
      const allHouseholdMembers =
        await this.householdService.findAllHouseholdMembers(
          applicationPackageId,
        );

      // first let's confirm the application package is complete.
      const isComplete =
        await this.isApplicationPackageComplete(applicationPackage);

      if (!isComplete) {
        // if it's not, we take an early exit
        // we probably have more screening forms to collect
        return {
          serviceRequestId: serviceRequestId,
        };
      }

      const primaryApplicant = await this.userService.findOne(
        applicationPackage.userId,
      );
      // We will create payloads for every other household-member
      // filter out the primary applicant (they were created on the initial submission)
      const nonPrimaryHouseholdMembers = allHouseholdMembers.filter(
        (member) => member.relationshipToPrimary != RelationshipToPrimary.Self,
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
              ServiceRequestId: serviceRequestId,
              IcmBcscDid: memberUser.bc_services_card_id,
              FirstName: memberUser.first_name,
              LastName: memberUser.last_name,
              DateofBirth: formatDateForSiebel(memberUser.dateOfBirth),
              StreetAddress: memberUser.street_address,
              City: memberUser.city,
              Prov: memberUser.region,
              PostalCode: memberUser.postal_code,
              EmailAddress: memberUser.email,
              HomePhone: memberUser.home_phone || '',
              AlternatePhone: memberUser.alternate_phone || '',
              Gender: this.userUtil.sexToGenderType(memberUser.sex),
              Relationship: householdMember.relationshipToPrimary,
              ApplicantFlag: getApplicantFlag(
                householdMember.relationshipToPrimary,
              ),
            };
          } else {
            // household member without user account (typically minors)
            prospectPayload = {
              ServiceRequestId: serviceRequestId,
              IcmBcscDid: '',
              FirstName: householdMember.firstName,
              LastName: householdMember.lastName,
              DateofBirth: formatDateForSiebel(householdMember.dateOfBirth),
              StreetAddress: primaryApplicant.street_address,
              City: primaryApplicant.city,
              Prov: primaryApplicant.region,
              PostalCode: primaryApplicant.postal_code,
              EmailAddress: '', //householdMember.email,
              HomePhone: '', //memberUser.homePhone || '',
              AlternatePhone: '', // memberUser.alternatePhone || '',
              Gender: householdMember.genderType,
              Relationship: householdMember.relationshipToPrimary,
              ApplicantFlag: getApplicantFlag(
                householdMember.relationshipToPrimary,
              ),
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
      try {
        // update the service request stage to Screening
        this.logger.info(
          { applicationPackageId, serviceRequestId },
          'Updating service request stage to Screening',
        );
        await this.siebelApiService.updateServiceRequestStage(
          serviceRequestId,
          'Screening',
        );
      } catch (error) {
        this.logger.error(
          {
            error,
            applicationPackageId,
            serviceRequestId,
          },
          'Failed to update service request stage to Screening',
        );
      }

      // Subsequent submission: get ALL forms for the package (all users)
      const allApplicationForms =
        await this.applicationFormService.findAllByApplicationPackageId(
          applicationPackageId,
        );
      const formsToAttach = allApplicationForms.filter(
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

      // track householdMemberIds that should use attachments instead of forms
      const householdMembersUsingAttachments = new Set<string>();

      const attachmentResults = [];
      for (const form of formsToAttach) {
        try {
          // if this form uses attached files, skip it and track the householdMemberId
          if (form.userAttachedForm) {
            householdMembersUsingAttachments.add(form.householdMemberId);
            this.logger.info(
              {
                applicationFormId: form.applicationFormId,
                householdMemberId: form.householdMemberId,
                formType: form.type,
              },
              'Form marked with userAttachedForm - will use attachments instead',
            );
            continue; // skip this form
          }

          if (form.formData) {
            let fileName = form.type as string;

            // files need to have unique names, so for screening forms, add the household member's name
            if (form.type === ApplicationFormType.SCREENING && form.userId) {
              const householdMember = allHouseholdMembers.find(
                (member) => member.userId === form.userId,
              );
              if (householdMember) {
                fileName = `${householdMember.firstName}_${householdMember.lastName}-SCREENING`;
              } else {
                this.logger.warn(
                  {
                    applicationFormId: form.applicationFormId,
                    userId: form.userId,
                  },
                  'Could not find household member for screening form - using default filename',
                );
              }
            }

            const fileContent = form.formData; // Buffer.from(formDataString).toString('base64');
            const formId = getFormIdForFormType(form.type);
            const xmlHierarchy =
              await this.applicationFormService.convertFormDataToXml(
                form.applicationFormId,
              );

            const attachmentResult =
              (await this.siebelApiService.createFormAttachment(
                serviceRequestId,
                {
                  fileName: fileName,
                  template: formId,
                  xmlHierarchy: xmlHierarchy,
                  fileContent: fileContent,
                },
              )) as { Id: string };

            attachmentResults.push({
              applicationFormId: form.applicationFormId,
              attachmentId: attachmentResult.Id,
            });

            this.logger.info(
              {
                serviceRequestId: serviceRequestId,
                applicationFormId: form.applicationFormId,
                fileName: fileName,
              },
              'Attachment created successfully for form',
            );
          } else {
            this.logger.warn(
              { applicationFormId: form.applicationFormId },
              'Skipping form with no data for attachment',
            );
          }
        } catch (error) {
          this.logger.error(
            {
              error,
              applicationFormId: form.applicationFormId,
              serviceRequestId: serviceRequestId,
            },
            'Failed to create attachment for form',
          );
        }
      }

      // Attach all attachments for householdMembers using attachments
      for (const householdMemberId of householdMembersUsingAttachments) {
        try {
          this.logger.info(
            { householdMemberId },
            'Fetching attachments for household member',
          );

          // Get all attachments for this household member (without file data)
          const attachmentList =
            await this.attachmentsService.findByHouseholdMemberId(
              householdMemberId,
            );

          this.logger.info(
            { householdMemberId, attachmentCount: attachmentList.length },
            'Found attachments to upload',
          );

          // Upload each attachment to Siebel
          for (const attachmentMeta of attachmentList) {
            try {
              // Get the full attachment with file data
              const fullAttachment = await this.attachmentsService.findById(
                attachmentMeta.attachmentId,
              );

              if (!fullAttachment || !fullAttachment.fileData) {
                this.logger.warn(
                  { attachmentId: attachmentMeta.attachmentId },
                  'Attachment not found or has no file data',
                );
                continue;
              }

              const attachmentResult =
                (await this.siebelApiService.createAttachment(
                  serviceRequestId,
                  {
                    fileName: fullAttachment.fileName,
                    fileContent: fullAttachment.fileData,
                    fileType: fullAttachment.fileType,
                    description:
                      fullAttachment.description ||
                      `Attachment for household member`,
                  },
                )) as { Id: string };

              attachmentResults.push({
                attachmentId: fullAttachment.attachmentId,
                siebelAttachmentId: attachmentResult.Id,
              });

              this.logger.info(
                {
                  serviceRequestId: serviceRequestId,
                  attachmentId: fullAttachment.attachmentId,
                  fileName: fullAttachment.fileName,
                  householdMemberId,
                },
                'Attachment uploaded successfully for household member',
              );
            } catch (error) {
              this.logger.error(
                {
                  error,
                  attachmentId: attachmentMeta.attachmentId,
                  householdMemberId,
                },
                'Failed to upload attachment for household member',
              );
            }
          }
        } catch (error) {
          this.logger.error(
            {
              error,
              householdMemberId,
            },
            'Failed to fetch attachments for household member',
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

      // now we need to update the service request to indicate the application has been submitted
      try {
        this.logger.info(
          { applicationPackageId, serviceRequestId },
          'Setting ICM CGA Application Received Flag to Y',
        );

        await this.siebelApiService.updateServiceRequestFields(
          serviceRequestId,
          { 'ICM CGA Application Received Flag': 'Y' },
        );

        this.logger.info(
          { applicationPackageId, serviceRequestId },
          'Successfully set ICM CGA Application Received Flag',
        );
      } catch (error) {
        this.logger.error(
          { error, applicationPackageId, serviceRequestId },
          'Failed to set ICM CGA Application Received Flag',
        );
      }

      await this.applicationPackageModel.findOneAndUpdate(
        { applicationPackageId },
        {
          status: ApplicationPackageStatus.SUBMITTED,
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

  // we lock an applicationPackage when the user has completed all the forms
  // and described a complete household definition
  // after locking, the adult household members will be notified to complete their
  // screening forms as applicable
  async lockApplicationPackage(
    applicationPackageId: string,
    userId: string,
  ): Promise<{ status: ApplicationPackageStatus }> {
    try {
      this.logger.info(
        { applicationPackageId, userId },
        'Attempting to lock application package',
      );

      // Verify ownership
      const applicationPackage = await this.applicationPackageModel
        .findOne({ applicationPackageId, userId })
        .lean();

      if (!applicationPackage) {
        throw new NotFoundException(
          `Application package ${applicationPackageId} not found or not owned by user, will not lock.`,
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
        // generate screening forms and access codes for each adult member
        await this.generateHousholdScreeningWorkflow(
          applicationPackageId,
          nonSelfAdultMembers,
        );

        await this.applicationPackageModel.findOneAndUpdate(
          { applicationPackageId },
          {
            status: ApplicationPackageStatus.CONSENT,
            updatedAt: new Date(),
          },
        );
        return {
          status: ApplicationPackageStatus.CONSENT,
        };
      } else {
        // there were no household screenings required.. we can skip the Consent status
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
        'Error locking the application package',
      );
      throw error;
    }
  }

  private async generateHousholdScreeningWorkflow(
    applicationPackageId: string,
    nonSelfAdultMembers: HouseholdMembersDocument[],
  ) {
    for (const member of nonSelfAdultMembers) {
      // create screening application form
      await this.applicationFormService.createScreeningFormsAndAccessCode(
        applicationPackageId,
        member.householdMemberId,
      );
    }
  }

  private async isApplicationPackageComplete(
    applicationPackage: ApplicationPackage,
  ): Promise<boolean> {
    // check that all required forms are complete

    const allApplicationForms =
      await this.applicationFormService.findAllByApplicationPackageId(
        applicationPackage.applicationPackageId,
      );

    // check the SCREENING type forms
    const screeningForms = allApplicationForms.filter(
      (form) => form.type === ApplicationFormType.SCREENING,
    );

    // check if ANY screening form is not complete;
    const incompleteScreeningForms = screeningForms.filter(
      (form) => form.status !== ApplicationFormStatus.COMPLETE,
    );

    if (screeningForms.length > 0 && incompleteScreeningForms.length > 0) {
      this.logger.info(
        {
          applicationPackageId: applicationPackage.applicationPackageId,
          totalScreeningForms: screeningForms.length,
          incompleteCount: incompleteScreeningForms.length,
          incompleteForms: incompleteScreeningForms.map((f) => ({
            applicationFormId: f.applicationFormId,
            userId: f.userId,
            status: f.status,
          })),
        },
        'Not all screening forms are complete',
      );
      return false;
    } else {
      this.logger.info(
        {
          applicationPackageId: applicationPackage.applicationPackageId,
          totalScreeningForms: screeningForms.length,
        },
        'Screening forms are complete',
      );
    }

    this.logger.info(
      'Skipping form completion check until feature completely implemented',
    );

    if (
      !allApplicationForms ||
      allApplicationForms
        .filter(
          (form) =>
            form.type !== ApplicationFormType.REFERRAL &&
            form.type !== ApplicationFormType.HOUSEHOLD,
        )
        .some((form) => form.status !== ApplicationFormStatus.COMPLETE)
    ) {
      this.logger.info('Application forms are not all complete for package');
      return false;
    }

    return true;
  }

  // upload medical assessment attachments to ICM and mark as complete

  async uploadMedicalAssessments(
    applicationPackageId: string,
    userId: string,
  ): Promise<{ success: boolean; attachmentsUploaded: number }> {
    this.logger.info(
      { applicationPackageId, userId },
      'Starting medical assessment upload to ICM',
    );

    // Get the application package
    const applicationPackage = (await this.applicationPackageModel
      .findOne({
        applicationPackageId,
      })
      .lean()
      .exec()) as ApplicationPackage;

    if (!applicationPackage) {
      throw new NotFoundException(
        `Application package ${applicationPackageId} not found`,
      );
    }

    // Verify the service request exists
    if (!applicationPackage.srId) {
      throw new BadRequestException(
        'Service request not created yet - cannot upload medical assessments',
      );
    }

    // Get all medical assessment attachments for this application package
    const attachments =
      await this.attachmentsService.findByApplicationPackageId(
        applicationPackageId,
        userId,
      );

    const medicalAssessmentAttachments = attachments.filter(
      (att) => att.attachmentType === AttachmentType.MEDICAL_ASSESSMENT,
    );

    if (medicalAssessmentAttachments.length === 0) {
      throw new BadRequestException(
        'No medical assessment attachments found for this application',
      );
    }

    this.logger.info(
      { count: medicalAssessmentAttachments.length },
      'Found medical assessment attachments to upload',
    );

    // Upload each attachment to ICM
    let uploadedCount = 0;
    for (const attachment of medicalAssessmentAttachments) {
      try {
        // Get the full attachment with file content
        const fullAttachment = await this.attachmentsService.findById(
          attachment.attachmentId,
        );

        if (!fullAttachment?.fileData) {
          this.logger.warn(
            { attachmentId: attachment.attachmentId },
            'Skipping attachment with no file content',
          );
          continue;
        }

        // Upload to Siebel
        await this.siebelApiService.createAttachment(applicationPackage.srId, {
          fileName: fullAttachment.fileName,
          fileContent: fullAttachment.fileData,
          fileType: fullAttachment.fileType,
          description: 'Medical Assessment Form',
        });

        uploadedCount++;
        this.logger.info(
          { fileName: fullAttachment.fileName },
          'Successfully uploaded medical assessment to ICM',
        );
      } catch (error) {
        this.logger.error(
          { error, attachmentId: attachment.attachmentId },
          'Failed to upload medical assessment attachment',
        );
        throw new InternalServerErrorException(
          `Failed to upload medical assessment`,
        );
      }
    }

    // Mark application package as having medical assessments
    await this.applicationPackageModel.findOneAndUpdate(
      { applicationPackageId },
      { $set: { hasMedicalAssessment: true, updatedAt: new Date() } },
      { new: true },
    );

    this.logger.info(
      { applicationPackageId, uploadedCount },
      'Medical assessments uploaded and marked complete',
    );

    return {
      success: true,
      attachmentsUploaded: uploadedCount,
    };
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
