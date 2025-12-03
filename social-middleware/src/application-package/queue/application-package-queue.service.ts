import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

@Injectable()
export class ApplicationPackageQueueService {
  constructor(
    @InjectQueue('applicationPackageQueue') private queue: Queue,
    @InjectPinoLogger(ApplicationPackageQueueService.name)
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Enqueue a completeness check for an application package
   * This checks if a package in CONSENT status is ready to move to READY
   */
  async enqueueCompletenessCheck(applicationPackageId: string): Promise<void> {
    await this.queue.add(
      'completeness-check',
      { applicationPackageId },
      {
        attempts: 3, // Completeness checks don't need as many retries
        backoff: {
          type: 'fixed',
          delay: 10000, // 10 seconds between attempts
        },
      },
    );

    this.logger.info(
      { applicationPackageId },
      'Enqueued completeness check for application package',
    );
  }

  /**
   * Enqueue submission of a READY package to Siebel/ICM
   * Uses default job options with exponential backoff
   */
  async enqueueSubmission(applicationPackageId: string): Promise<void> {
    // Check if already queued to prevent duplicates
    const existingJobs = await this.queue.getJobs([
      'waiting',
      'active',
      'delayed',
    ]);
    const alreadyQueued = existingJobs.some(
      (job) =>
        job.name === 'submission' &&
        job.data.applicationPackageId === applicationPackageId,
    );

    if (alreadyQueued) {
      this.logger.info(
        { applicationPackageId },
        'Submission already queued, skipping duplicate',
      );
      return;
    }

    await this.queue.add('submission', { applicationPackageId });

    this.logger.info(
      { applicationPackageId },
      'Enqueued submission for application package',
    );
  }

  /**
   * Scan for packages that need processing
   * Called by cron job periodically
   */
  async scanAndEnqueuePackages(): Promise<{
    completenessChecks: number;
    submissions: number;
  }> {
    this.logger.info('Starting periodic scan for application packages');

    await this.queue.add('periodic-scan', {});

    return { completenessChecks: 0, submissions: 0 }; // Actual counts from processor
  }
}
