import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

@Injectable()
export class IcmStageQueueService {
  constructor(
    @InjectQueue('icmStageQueue') private readonly icmStageQueue: Queue,
    @InjectPinoLogger(IcmStageQueueService.name)
    private readonly logger: PinoLogger,
  ) {}

  async checkICMStages(): Promise<void> {
    try {
      const waiting = await this.icmStageQueue.getWaitingCount();
      const active = await this.icmStageQueue.getActiveCount();
      if (waiting > 0 || active > 0) {
        this.logger.info(
          { waiting, active },
          'ICM stage check already queued or active, skipping',
        );
        return;
      }

      this.logger.info('Adding ICM stage check job to queue');
      const job = await this.icmStageQueue.add('check-icm-stage', {});
      this.logger.info(
        { jobId: job.id },
        'ICM stage check job added successfully',
      );
    } catch (error) {
      this.logger.error(
        { error },
        'Failed to add ICM stage check job to queue',
      );
      throw error;
    }
  }
}
