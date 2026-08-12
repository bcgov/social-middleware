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
import {
  //ApplicationPackageSubType,
  //ApplicationPackageSubSubType,
  getDefaultSrStage,
} from '../enums/application-package-subtypes.enum';
import { ApplicationPackageService } from '../services/application-package.service';
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
import {
  ApplicationFormType,
  getFormIdForFormType,
} from '../../application-form/enums/application-form-types.enum';
import { ProspectService } from '../services/prospect.service';
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
    private readonly prospectService: ProspectService,
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
        await job.queue.add(
          'completeness-check',
          {
            applicationPackageId: pkg.applicationPackageId,
          },
          {
            jobId: `completeness-check-${pkg.applicationPackageId}`,
            removeOnComplete: true,
          },
        );
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
          .filter((j) => j != null && j.name === 'submission')
          .map(
            (j) =>
              (j.data as { applicationPackageId: string }).applicationPackageId,
          ),
      );

      // Enqueue submissions for packages not already queued
      for (const pkg of readyPackages) {
        if (!queuedPackageIds.has(pkg.applicationPackageId)) {
          await job.queue.add(
            'submission',
            { applicationPackageId: pkg.applicationPackageId },
            { jobId: `submission-${pkg.applicationPackageId}` },
          );
          submissions++;
        } else {
          this.logger.debug(
            { applicationPackageId: pkg.applicationPackageId },
            'Package already queued for submission, skipping',
          );
        }
      }

      // find REFERRAL packages that may have failed to enqueue
      const orphanedReferrals = await this.applicationPackageModel
        .find({
          status: ApplicationPackageStatus.REFERRAL,
          srId: { $in: [null, undefined, ''] },
          updatedAt: { $lt: new Date(Date.now() - 2 * 60 * 1000) }, // older than 2 minutes
        })
        .lean()
        .exec();

      for (const pkg of orphanedReferrals) {
        this.logger.info(
          { applicationPackageId: pkg.applicationPackageId },
          'Found orphaned referral package - re-enqueuing',
        );
        await job.queue.add(
          'submit-referral',
          {
            applicationPackageId: pkg.applicationPackageId,
            userId: pkg.userId,
            dto: {},
          },
          { jobId: `submit-referral-${pkg.applicationPackageId}` },
        );
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
        // Self-heal a known status glitch: the package was submitted but the
        // applicant's Prior Contact Check is stuck in DRAFT. If it's the only
        // remaining incomplete primary form, correct the status to COMPLETE and let
        // the next scan retry. (Not a content check — a social worker will catch a
        // genuinely-incomplete form on review and request resubmission.)
        const lone = incompletePrimaryForms[0];
        if (
          incompletePrimaryForms.length === 1 &&
          lone.type === ApplicationFormType.PCCCONSENT
        ) {
          this.logger.warn(
            {
              applicationPackageId,
              applicationFormId: lone.applicationFormId,
              previousStatus: lone.status,
            },
            'Correcting stuck primary PCC consent form from DRAFT to COMPLETE; deferring for retry',
          );

          await this.applicationFormService.updateFormStatus(
            lone.applicationFormId,
            ApplicationFormStatus.COMPLETE,
          );

          return {
            isComplete: false,
            status: ApplicationPackageStatus.CONSENT,
          };
        }

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
      await job.queue.add(
        'submission',
        { applicationPackageId },
        { jobId: `submission-${applicationPackageId}` },
      );

      return { isComplete: true, status: ApplicationPackageStatus.READY };
    } catch (error) {
      this.logger.error(
        { error, applicationPackageId },
        'Error during completeness check',
      );
      throw error;
    }
  }

  @Process('notify-cancellation')
  async handleCancellationNotification(
    job: Job<{ applicationPackageId: string; srId: string }>,
  ): Promise<{ success: boolean }> {
    const { applicationPackageId, srId } = job.data;

    const appPackage = await this.applicationPackageModel
      .findOne({ applicationPackageId })
      .lean()
      .exec();

    if (!appPackage?.srId) {
      this.logger.warn(
        { applicationPackageId, srId },
        'No application package/srId found for cancellation notification job; skipping',
      );
      return { success: false };
    }

    const srDetails = await this.siebelApiService.getIcmServiceRequestById(
      appPackage.srId,
    );

    if (!srDetails) {
      this.logger.warn(
        { applicationPackageId, srId },
        'Service Request not found in ICM during queued cancellation notification; skipping',
      );
      return { success: false };
    }

    if (!srDetails['Assigned To'] || !srDetails['Assigned To Id']) {
      this.logger.warn(
        {
          srId: appPackage.srId,
        },
        'SR is unassigned; skipping',
      );
    } else {
      // create a service request notification assigned to the service request assignee
      await this.siebelApiService.createSRNotification(appPackage.srId, {
        serviceRequestNumber: srDetails['Service Request Number']!,
        owner: srDetails['Assigned To Id'],
        assignedTo: srDetails['Assigned To'],
        //officeId: srDetails['Service Office Id'],
      });
    }

    if (this.configService.get<string>('OCT2027_RELEASE_ENABLED') === 'true') {
      await this.siebelApiService.updateServiceRequestFields(appPackage.srId, {
        Resolution: 'Withdrawn',
        'CP Outcome':
          'Withdrawn via portal on ' + formatDateForSiebel(new Date()),
        'ICM CGA Resolution Decision Date': formatDateForSiebel(new Date()),
      });
    }

    return { success: true };
  }

  /**
   * Process submit individual form to attachment on SR
   * Idempotent - can be safely retried
   */

  @Process('resubmit-form')
  async handleFormResubmission(
    job: Job<{ applicationFormId: string }>,
  ): Promise<{ success: boolean }> {
    const { applicationFormId } = job.data;

    this.logger.info(
      { jobId: job.id, applicationFormId },
      'Processing form resubmission to Siebel',
    );

    const form =
      await this.applicationFormService.findOneById(applicationFormId);
    if (!form) {
      this.logger.warn(
        { applicationFormId },
        'Form not found for resubmission - removing stale job',
      );
      return { success: false };
    }

    if (!form.formData) {
      this.logger.warn(
        { applicationFormId },
        'Form has no data - skipping ICM attachment',
      );
      return { success: false };
    }

    const applicationPackage = await this.applicationPackageModel
      .findOne({ applicationPackageId: form.applicationPackageId })
      .lean()
      .exec();

    if (!applicationPackage?.srId) {
      throw new InternalServerErrorException(
        `No Siebel SR ID found for package ${form.applicationPackageId}`,
      );
    }

    const formId = getFormIdForFormType(form.type);
    const xmlHierarchy =
      await this.applicationFormService.convertFormDataToXml(applicationFormId);

    // Append applicant name to consent form filenames, matching original submission behaviour
    let fileName = form.type as string;
    if (
      (form.type === ApplicationFormType.DISCLOSURECONSENT ||
        form.type === ApplicationFormType.PCCCONSENT) &&
      form.userId
    ) {
      const memberUser = await this.userService.findOne(form.userId);
      if (memberUser) {
        const { firstName } = this.userUtil.firstAndMiddleName(
          memberUser.first_name,
        );
        fileName = `${firstName}_${this.userUtil.toTitleCase(memberUser.last_name)}-${form.type}`;
      }
    }
    // prefix all re-submitted forms with today's date
    //const now = new Date();
    //const datePrefix = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${now.getFullYear()}`;
    //fileName = `${datePrefix}-${fileName}`;
    fileName = `AMENDED-${fileName}`;

    const attachmentResult = (await this.siebelApiService.createFormAttachment(
      applicationPackage.srId,
      {
        fileName: fileName,
        template: formId,
        xmlHierarchy,
        fileContent: form.formData,
      },
    )) as { items: { Id: string } };

    await this.applicationFormService.saveSiebelAttachmentId(
      applicationFormId,
      attachmentResult.items?.Id,
    );

    this.logger.info(
      {
        applicationFormId,
        srId: applicationPackage.srId,
        attachmentId: attachmentResult.items?.Id,
      },
      'Form resubmission to Siebel complete',
    );

    return { success: true };
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
        email: dto.email || primaryApplicant.email,
        home_phone: dto.home_phone || primaryApplicant.homePhone,
        alternate_phone: dto.alternate_phone || primaryApplicant.alternatePhone,
      });

      const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
      const envSuffix = nodeEnv.toLowerCase().includes('prod') ? '' : nodeEnv;

      const srPayload = {
        Id: 'NULL',
        Status: 'Open',
        Priority: '3-Standard',
        Type: 'Caregiver Application',
        //'ICM Stage': getDefaultSrStage(pkg.subtype),
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

      prospectId = await this.prospectService.createKeyPlayerProspect(
        primaryUser,
        srId,
        {
          householdMemberId: primaryApplicant.householdMemberId,
          contact: {
            email: dto.email || primaryApplicant.email,
            homePhone: dto.home_phone ?? primaryApplicant.homePhone,
            alternatePhone:
              dto.alternate_phone || primaryApplicant.alternatePhone,
          },
        },
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

    // step 3: attach indigenous form to Siebel

    const forms = await this.applicationFormService.findByPackageAndUser(
      applicationPackageId,
      userId,
    );
    const indigenousForm = forms.find(
      (f) => f.type === ApplicationFormType.INDIGENOUS,
    );

    if (indigenousForm?.formData && !indigenousForm.siebelAttachmentId) {
      this.logger.info(
        {
          applicationPackageId,
          applicationFormId: indigenousForm.applicationFormId,
        },
        'Step 3: attaching Indigenous Form to Siebel',
      );

      const formId = getFormIdForFormType(ApplicationFormType.INDIGENOUS);
      const xmlHierarchy =
        await this.applicationFormService.convertFormDataToXml(
          indigenousForm.applicationFormId,
        );

      const attachmentResult =
        (await this.siebelApiService.createFormAttachment(srId, {
          fileName: indigenousForm.type,
          template: formId,
          xmlHierarchy: xmlHierarchy,
          fileContent: indigenousForm.formData,
        })) as { items: { Id: string } };

      await this.applicationFormService.saveSiebelAttachmentId(
        indigenousForm.applicationFormId,
        attachmentResult.items.Id,
      );

      this.logger.info(
        {
          applicationPackageId,
          srId,
          attachmentId: attachmentResult.items.Id,
        },
        'Indigenous form attached to Siebel SR',
      );
    } else if (indigenousForm?.siebelAttachmentId) {
      this.logger.info(
        {
          applicationPackageId,
          siebelAttachmentId: indigenousForm.siebelAttachmentId,
        },
        'Step 3: Indigenous form already attached, skipping',
      );
    } else {
      this.logger.warn(
        { applicationPackageId },
        'Indigenous form not found or has no form data - skipping attachment',
      );
    }

    // Step 4: Update SR Stage
    this.logger.info(
      { applicationPackageId, srId },
      'Step 3: Updating service request stage to Referral',
    );

    await this.siebelApiService.updateServiceRequestStage(
      srId,
      getDefaultSrStage(pkg.subtype),
    );

    this.logger.info(
      { applicationPackageId, srId },
      'Referral submission complete - all Siebel operations successful',
    );

    // STEP 4: Enqueue email notification (separate queue)
    await this.notificationService.sendReferralRequested(
      dto.email || primaryApplicant.email || '', // email
      `${primaryUser.first_name} ${primaryUser.last_name}`,
    );

    return { srId };
  }

  // create a keyplayer prospect, usually because we redeemed an access code
  @Process('create-prospect')
  async handleProspectCreation(
    job: Job<{
      applicationPackageId: string;
      bcscDid: string;
      householdMemberId: string;
      srId: string;
    }>,
  ): Promise<void> {
    const { applicationPackageId, bcscDid, householdMemberId, srId } = job.data;

    const member = await this.householdService.findById(householdMemberId);
    if (member?.prospectId) {
      this.logger.info(
        { applicationPackageId, householdMemberId },
        'Prospect already exists — skipping',
      );
      return;
    }

    const user = await this.userService.findByBcServicesCardId(bcscDid);
    await this.prospectService.createKeyPlayerProspect(user, srId, {
      householdMemberId,
    });
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

      if (!applicationPackage.userId) {
        this.logger.warn(
          { applicationPackageId },
          'Package has no userId, this is required for submission',
        );
        return { success: false };
      }

      // Call the existing submission logic

      const result =
        await this.applicationPackageService.submitApplicationPackage(
          applicationPackageId,
          applicationPackage.userId,
        );

      if (!result.isComplete) {
        // Package not ready yet (waiting on screening forms etc.) — leave as pending for retry
        await this.applicationPackageModel.findOneAndUpdate(
          { applicationPackageId },
          {
            submissionStatus: SubmissionStatus.PENDING,
            updatedAt: new Date(),
          },
        );

        this.logger.info(
          { applicationPackageId },
          'Package not yet complete — submission deferred, will retry',
        );

        return { success: false, serviceRequestId: result.serviceRequestId };
      }

      // Fully submitted
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
    const isLastAttempt = job.attemptsMade >= (job.opts.attempts ?? 1);

    if (isLastAttempt) {
      this.logger.error(
        {
          jobId: job.id,
          jobName: job.name,
          error: error.message,
          attempts: job.attemptsMade,
        },
        'Job failed after all retry attempts',
      );
    } else {
      this.logger.warn(
        {
          jobId: job.id,
          jobName: job.name,
          error: error.message,
          attempt: job.attemptsMade,
          maxAttempts: job.opts.attempts,
        },
        'Job attempt failed, will retry',
      );
    }

    // If it's a submission job, mark as FAILED on the last attempt
    if (
      isLastAttempt &&
      job.name === 'submission' &&
      job.data.applicationPackageId
    ) {
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
