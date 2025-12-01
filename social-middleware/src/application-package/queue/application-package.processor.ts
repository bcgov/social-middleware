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
import { SubmissionStatus } from '../enums/submission-status.enum';
import { ApplicationFormService } from 'src/application-form/services/application-form.service';
import { HouseholdService } from 'src/household/services/household.service';
import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { ApplicationFormType } from '../../application-form/enums/application-form-types.enum';
import { ApplicationFormStatus } from '../../application-form/enums/application-form-status.enum';

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
          .map((j) => j.data.applicationPackageId),
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

      // Check if all screening forms are complete
      const allApplicationForms =
        await this.applicationFormService.findAllByApplicationPackageId(
          applicationPackageId,
        );

      const screeningForms = allApplicationForms.filter(
        (form) => form.type === ApplicationFormType.SCREENING,
      );

      const incompleteScreeningForms = screeningForms.filter(
        (form) => form.status !== ApplicationFormStatus.COMPLETE,
      );

      if (screeningForms.length > 0 && incompleteScreeningForms.length > 0) {
        this.logger.info(
          {
            applicationPackageId,
            totalScreeningForms: screeningForms.length,
            incompleteCount: incompleteScreeningForms.length,
          },
          'Screening forms not yet complete',
        );
        return { isComplete: false, status: ApplicationPackageStatus.CONSENT };
      }

      // Validate household completion
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
        this.logger.error(
          { applicationPackageId },
          'Application package not found',
        );
        throw new Error(
          `Application package ${applicationPackageId} not found`,
        );
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
      // You'll need to inject ApplicationPackageService here
      // For now, I'll show the structure:

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
  onCompleted(job: Job, result: any) {
    this.logger.info(
      {
        jobId: job.id,
        jobName: job.name,
        data: job.data,
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
        data: job.data,
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
        { applicationPackageId: job.data.applicationPackageId },
        'Marked package submission as FAILED after exhausting retries',
      );
    }
  }
}
