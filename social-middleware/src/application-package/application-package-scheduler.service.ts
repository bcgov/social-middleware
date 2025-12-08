import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ApplicationPackageQueueService } from './queue/application-package-queue.service';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

@Injectable()
export class ApplicationPackageSchedulerService {
  constructor(
    private readonly queueService: ApplicationPackageQueueService,
    @InjectPinoLogger(ApplicationPackageSchedulerService.name)
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Runs every 2 minutes to check for packages needing processing
   * Adjust the cron expression as needed
   */
  @Cron('*/2 * * * *') // every 2 minutes
  async scanForPackages() {
    this.logger.info('Cron job triggered: scanning for application packages');

    try {
      const result = await this.queueService.scanAndEnqueuePackages();

      this.logger.info(
        {
          completenessChecks: result.completenessChecks,
          submissions: result.submissions,
        },
        'Cron job completed successfully',
      );
    } catch (error) {
      this.logger.error({ error }, 'Cron job failed during package scan');
    }
  }
}
