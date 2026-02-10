import {
  Processor,
  Process,
  OnQueueCompleted,
  OnQueueFailed,
} from '@nestjs/bull';
import { Job } from 'bull';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  ApplicationPackage,
  ApplicationPackageDocument,
} from '../schema/application-package.schema';
import { ApplicationPackageService } from '../application-package.service';
import { ApplicationPackageStatus } from '../enums/application-package-status.enum';
import { formatDateForSiebel } from '../../common/utils/date.util';
import { SubmissionStatus } from '../enums/submission-status.enum';
import { SubmitReferralRequestDto } from '../dto/submit-referral-request.dto';
import { ApplicationFormService } from 'src/application-form/services/application-form.service';
import { HouseholdService } from 'src/household/services/household.service';
import {
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
//import { ApplicationFormType } from '../../application-form/enums/application-form-types.enum';
import { ApplicationFormStatus } from '../../application-form/enums/application-form-status.enum';
import { RelationshipToPrimary } from '../../household/enums/relationship-to-primary.enum';
import { ApplicationFormType } from '../../application-form/enums/application-form-types.enum';
import { SiebelApiService } from '../../siebel/siebel-api.service';
import { ConfigService } from '@nestjs/config';
import { UserService } from '../../auth/user.service';
import { UserUtil } from '../../common/utils/user.util';
import { NotificationService } from '../../notifications/services/notification.service';

@Injectable()
@Processor('applicationPackageQueue')
export class ApplicationPackageProcessor {
  constructor(
    @InjectModel(ApplicationPackage.name)
    private readonly applicationPackageModel: Model<ApplicationPackageDocument>,
    private readonly applicationFormService: ApplicationFormService,
    @Inject(forwardRef(() => ApplicationPackageService))
    private readonly applicationPackageService: ApplicationPackageService,
    private readonly householdService: HouseholdService,
    private readonly userService: UserService,
    private readonly siebelApiService: SiebelApiService,
    private readonly configService: ConfigService,
    private readonly notificationService: NotificationService,
    private readonly userUtil: UserUtil,
    @InjectPinoLogger(ApplicationPackageProcessor.name)
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Process periodic scan job
   * Finds packages that need completeness checks or submission
   */
  @Process('periodic-scan')
  async handlePeriodicScan(job: Job): Promise<{
    completenessChecks: number;
    submissions: number;
  }> {
    this.logger.info('Processing periodic scan for application packages');

    let completenessChecks = 0;
    let submissions = 0;

    try {
      // Find CONSENT packages that might be ready for submission
      const consentPackages = await this.applicationPackageModel
        .find({
          status: ApplicationPackageStatus.CONSENT,
          submissionStatus: { $in: ['pending', 'error'] }, // Skip 'success' and 'failed'
        })
        .lean()
        .exec();

      this.logger.info(
        { count: consentPackages.length },
        'Found CONSENT packages to check for completeness',
      );

      // Enqueue completeness checks for each
      for (const pkg of consentPackages) {
        await job.queue.add('completeness-check', {
          applicationPackageId: pkg.applicationPackageId,
        });
        completenessChecks++;
      }

      // Find READY packages that need submission
      const readyPackages = await this.applicationPackageModel
        .find({
          status: ApplicationPackageStatus.READY,
          submissionStatus: { $in: ['pending', 'error'] },
        })
        .lean()
        .exec();

      this.logger.info(
        { count: readyPackages.length },
        'Found READY packages to submit',
      );

      // Check if already queued to prevent duplicates
      const queuedJobs = await job.queue.getJobs([
        'waiting',
        'active',
        'delayed',
      ]);
      const queuedPackageIds = new Set(
        queuedJobs
          .filter((j) => j.name === 'submission')
          .map(
            (j) =>
              (j.data as { applicationPackageId: string }).applicationPackageId,
          ),
      );

      // Enqueue submissions for packages not already queued
      for (const pkg of readyPackages) {
        if (!queuedPackageIds.has(pkg.applicationPackageId)) {
          await job.queue.add('submission', {
            applicationPackageId: pkg.applicationPackageId,
          });
          submissions++;
        } else {
          this.logger.debug(
            { applicationPackageId: pkg.applicationPackageId },
            'Package already queued for submission, skipping',
          );
        }
      }

      this.logger.info(
        { completenessChecks, submissions },
        'Completed periodic scan',
      );

      return { completenessChecks, submissions };
    } catch (error) {
      this.logger.error({ error }, 'Error during periodic scan');
      throw error;
    }
  }
  /**
   * Check if a package is complete and ready for submission
   * If complete, update status from CONSENT to READY and enqueue submission
   */
  @Process('completeness-check')
  async handleCompletenessCheck(
    job: Job<{ applicationPackageId: string }>,
  ): Promise<{ isComplete: boolean; status: ApplicationPackageStatus }> {
    const { applicationPackageId } = job.data;

    this.logger.info(
      { applicationPackageId, attemptNumber: job.attemptsMade + 1 },
      'Processing completeness check',
    );

    try {
      // Load the package
      const applicationPackage = await this.applicationPackageModel
        .findOne({ applicationPackageId })
        .lean()
        .exec();

      if (!applicationPackage) {
        this.logger.warn(
          { applicationPackageId },
          'Application package not found for completeness check',
        );
        return { isComplete: false, status: ApplicationPackageStatus.DRAFT };
      }

      // Only check packages in CONSENT status
      if (applicationPackage.status !== ApplicationPackageStatus.CONSENT) {
        this.logger.info(
          { applicationPackageId, status: applicationPackage.status },
          'Package not in CONSENT status, skipping completeness check',
        );
        return { isComplete: false, status: applicationPackage.status };
      }

      // get all the application forms
      const allApplicationForms =
        await this.applicationFormService.findAllByApplicationPackageId(
          applicationPackageId,
        );
      //get all household members
      const householdMembers =
        await this.householdService.findAllHouseholdMembers(
          applicationPackageId,
        );

      const primaryApplicant = householdMembers.find(
        (member) => member.relationshipToPrimary === RelationshipToPrimary.Self,
      );

      if (!primaryApplicant) {
        this.logger.error(
          { applicationPackageId },
          'No primary applicant found for application package',
        );
        return { isComplete: false, status: ApplicationPackageStatus.CONSENT };
      }

      // Get all forms for the primary applicant
      const primaryApplicantForms = allApplicationForms.filter(
        (form) =>
          form.householdMemberId === primaryApplicant.householdMemberId &&
          form.type !== ApplicationFormType.REFERRAL &&
          form.type !== ApplicationFormType.HOUSEHOLD,
      );

      const incompletePrimaryForms = primaryApplicantForms.filter(
        (form) => form.status !== ApplicationFormStatus.COMPLETE,
      );

      if (incompletePrimaryForms.length > 0) {
        this.logger.info(
          {
            applicationPackageId,
            totalPrimaryForms: primaryApplicantForms.length,
            incompleteCount: incompletePrimaryForms.length,
          },
          'Primary applicant forms not yet complete',
        );
        return { isComplete: false, status: ApplicationPackageStatus.CONSENT };
      }

      // Validate household information completion
      const householdValidation =
        await this.householdService.validateHouseholdCompletion(
          applicationPackageId,
          applicationPackage.hasPartner,
          applicationPackage.hasHousehold,
        );

      if (!householdValidation.isComplete) {
        this.logger.info(
          { applicationPackageId, householdValidation },
          'Household not complete',
        );
        return { isComplete: false, status: ApplicationPackageStatus.CONSENT };
      }

      // now let's check the household members requiring screening have screeningInfoProvided = true

      const membersRequiringScreening = householdMembers.filter(
        (member) =>
          member.requireScreening === true &&
          member.relationshipToPrimary !== RelationshipToPrimary.Self,
      );

      const membersWithoutScreening = membersRequiringScreening.filter(
        (member) => member.screeningInfoProvided !== true,
      );

      if (membersWithoutScreening.length > 0) {
        this.logger.info(
          {
            applicationPackageId,
            totalRequiringScreening: membersRequiringScreening.length,
            missingScreeningCount: membersWithoutScreening.length,
            membersWithoutScreening: membersWithoutScreening.map((m) => ({
              householdMemberId: m.householdMemberId,
              name: `${m.firstName} ${m.lastName}`,
              relationshipToPrimary: m.relationshipToPrimary,
            })),
          },
          'Household members requiring screening have not provided screening info',
        );
        return { isComplete: false, status: ApplicationPackageStatus.CONSENT };
      }

      this.logger.info(
        {
          applicationPackageId,
          primaryFormsCompleted: primaryApplicantForms.length,
          screeningMembersCompleted: membersRequiringScreening.length,
        },
        'All primary applicant forms complete and all required screening info provided',
      );

      // Package is complete! Update to READY and enqueue submission
      await this.applicationPackageModel.findOneAndUpdate(
        { applicationPackageId },
        {
          status: ApplicationPackageStatus.READY,
          submissionStatus: SubmissionStatus.PENDING,
          updatedAt: new Date(),
        },
      );

      this.logger.info(
        { applicationPackageId },
        'Package is complete, updated to READY status and enqueueing submission',
      );

      // Enqueue submission
      await job.queue.add('submission', { applicationPackageId });

      return { isComplete: true, status: ApplicationPackageStatus.READY };
    } catch (error) {
      this.logger.error(
        { error, applicationPackageId },
        'Error during completeness check',
      );
      throw error;
    }
  }

  /**
   * Process referral submission to Siebel
   * Idempotent - can be safely retried
   */

  @Process('submit-referral')
  async handleReferralSubmission(
    job: Job<{
      applicationPackageId: string;
      userId: string;
      dto: SubmitReferralRequestDto;
    }>,
  ): Promise<{ srId: string }> {
    const { applicationPackageId, userId, dto } = job.data;
    this.logger.info(
      { jobId: job.id, applicationPackageId, userId },
      'Processing referral submission',
    );

    // get application package
    const pkg = await this.applicationPackageModel
      .findOne({ applicationPackageId, userId })
      .exec();

    if (!pkg) {
      this.logger.warn(
        { jobId: job.id, applicationPackageId, userId },
        'Application package not found - removing stale job',
      );
      return { srId: '' };
    }

    // get primary applicant household member
    const primaryApplicant =
      await this.householdService.findPrimaryApplicant(applicationPackageId);

    if (!primaryApplicant) {
      throw new NotFoundException('Primary applicant not found');
    }

    // get user details
    const primaryUser = await this.userService.findOne(userId);

    // Step 1: Create Service request; skip if it exists
    let srId: string | undefined = pkg.srId;

    if (!srId) {
      this.logger.info(
        { applicationPackageId },
        'Step 1: Creating service request in Siebel',
      );

      // update user contact info from referral form
      await this.userService.update(userId, {
        email: dto.email,
        home_phone: dto.home_phone,
        alternate_phone: dto.alternate_phone,
      });

      const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
      const envSuffix = nodeEnv.toLowerCase().includes('prod') ? '' : nodeEnv;

      const srPayload = {
        Id: 'NULL',
        Status: 'Open',
        Priority: '3-Standard',
        Type: 'Caregiver Application',
        'SR Sub Type': pkg.subtype,
        'SR Sub Sub Type': pkg.subsubtype,
        'ICM BCSC DID': primaryUser.bc_services_card_id,
        'Service Office': 'XRA',
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

      srId = (siebelResponse as { items?: { Id?: string } })?.items?.Id;

      if (!srId) {
        this.logger.error(
          { siebelResponse },
          'No service request ID in response',
        );
        throw new InternalServerErrorException(
          'Failed to get service request ID from Siebel',
        );
      }

      // Save SR ID immediately for idempotency
      await this.applicationPackageModel.updateOne(
        { _id: pkg._id },
        { srId: srId },
      );

      this.logger.info(
        { applicationPackageId, srId },
        'Service request created',
      );
    } else {
      this.logger.info(
        { applicationPackageId, srId },
        'Step 1: Service request already exists, skipping',
      );
    }

    // STEP 2: Create Prospect for primary applicant (Idempotent - skip if exists)
    let prospectId = primaryApplicant.prospectId;

    if (!prospectId) {
      this.logger.info(
        {
          applicationPackageId,
          srId,
          householdMemberId: primaryApplicant.householdMemberId,
        },
        'Step 2: Creating prospect in Siebel for primary applicant',
      );

      const primaryUserProspectPayload = {
        ServiceRequestId: srId,
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

      prospectId = siebelProspectResponse?.items?.Id;

      if (!prospectId) {
        this.logger.error(
          { siebelProspectResponse },
          'Failed to create prospect',
        );
        throw new InternalServerErrorException('Failed to create prospect');
      }

      // Save prospect ID to household member
      await this.householdService.updateHouseholdMember(
        primaryApplicant.householdMemberId,
        { prospectId },
      );

      this.logger.info(
        {
          applicationPackageId,
          prospectId,
          householdMemberId: primaryApplicant.householdMemberId,
        },
        'Prospect created for primary applicant',
      );
    } else {
      this.logger.info(
        {
          applicationPackageId,
          prospectId,
          householdMemberId: primaryApplicant.householdMemberId,
        },
        'Step 2: Prospect already exists for primary applicant, skipping',
      );
    }

    // Step 3: Update SR Stage
    this.logger.info(
      { applicationPackageId, srId },
      'Step 3: Updating service request stage to Referral',
    );

    await this.siebelApiService.updateServiceRequestStage(srId, 'Referral');

    this.logger.info(
      { applicationPackageId, srId },
      'Referral submission complete - all Siebel operations successful',
    );

    // STEP 4: Enqueue email notification (separate queue)
    await this.notificationService.sendReferralRequested(
      'Tim.Gunderson@gov.bc.ca',
      `${primaryUser.first_name} ${primaryUser.last_name}`,
    );

    return { srId };
  }

  /**
   * Submit a READY package to ICM
   * This is the main submission process with retry logic
   */
  @Process('submission')
  async handleSubmission(
    job: Job<{ applicationPackageId: string }>,
  ): Promise<{ success: boolean; serviceRequestId?: string }> {
    const { applicationPackageId } = job.data;
    const attemptNumber = job.attemptsMade + 1;

    this.logger.info(
      { applicationPackageId, attemptNumber, maxAttempts: job.opts.attempts },
      'Processing submission to Siebel',
    );

    try {
      // Load the package
      const applicationPackage = await this.applicationPackageModel
        .findOne({ applicationPackageId })
        .exec();

      if (!applicationPackage) {
        this.logger.warn(
          { applicationPackageId },
          'Application package not found - removing stale job',
        );
        return { success: false };
      }

      // Only submit READY packages
      if (applicationPackage.status !== ApplicationPackageStatus.READY) {
        this.logger.warn(
          { applicationPackageId, status: applicationPackage.status },
          'Package not in READY status, skipping submission',
        );
        return { success: false };
      }

      // Update attempt tracking
      await this.applicationPackageModel.findOneAndUpdate(
        { applicationPackageId },
        {
          submissionAttempts: attemptNumber,
          lastSubmissionAttempt: new Date(),
          submissionStatus: SubmissionStatus.PENDING,
        },
      );

      // Call the existing submission logic

      const result =
        await this.applicationPackageService.submitApplicationPackage(
          applicationPackageId,
          applicationPackage.userId,
        );

      // After successful submission:
      await this.applicationPackageModel.findOneAndUpdate(
        { applicationPackageId },
        {
          submissionStatus: SubmissionStatus.SUCCESS,
          lastSubmissionError: null,
          updatedAt: new Date(),
        },
      );

      this.logger.info(
        { applicationPackageId, serviceRequestId: result.serviceRequestId },
        'Successfully submitted package to Siebel',
      );

      return { success: true, serviceRequestId: result.serviceRequestId };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        {
          error,
          applicationPackageId,
          attemptNumber,
          maxAttempts: job.opts.attempts,
        },
        'Error submitting package to Siebel',
      );

      // Update with error details
      await this.applicationPackageModel.findOneAndUpdate(
        { applicationPackageId },
        {
          lastSubmissionError: errorMessage.substring(0, 500), // Limit error length
          submissionStatus: SubmissionStatus.ERROR,
          updatedAt: new Date(),
        },
      );

      // Re-throw to trigger Bull's retry mechanism
      throw error;
    }
  }

  /**
   * Event handler: Called when a job completes successfully
   */
  @OnQueueCompleted()
  onCompleted(job: Job, result: unknown) {
    this.logger.info(
      {
        jobId: job.id,
        jobName: job.name,
        result,
      },
      'Job completed successfully',
    );
  }

  /**
   * Event handler: Called when a job fails after all retries
   */
  @OnQueueFailed()
  async onFailed(job: Job, error: Error) {
    this.logger.error(
      {
        jobId: job.id,
        jobName: job.name,
        error: error.message,
        attempts: job.attemptsMade,
      },
      'Job failed after all retry attempts',
    );

    // If it's a submission job, mark as FAILED
    if (job.name === 'submission' && job.data.applicationPackageId) {
      await this.applicationPackageModel.findOneAndUpdate(
        { applicationPackageId: job.data.applicationPackageId },
        {
          submissionStatus: SubmissionStatus.FAILED,
          lastSubmissionError: error.message.substring(0, 500),
          updatedAt: new Date(),
        },
      );

      this.logger.error(
        {
          applicationPackageId: (job.data as { applicationPackageId?: string })
            .applicationPackageId,
        },
        'Marked package submission as FAILED after exhausting retries',
      );
    }
  }
}
