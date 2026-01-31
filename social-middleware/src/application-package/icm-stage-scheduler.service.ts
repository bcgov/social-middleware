import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IcmStageQueueService } from './queue/icm-stage-queue.service';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

@Injectable()
export class IcmStageSchedulerService {
  constructor(
    private readonly icmStageQueueService: IcmStageQueueService,
    @InjectPinoLogger(IcmStageSchedulerService.name)
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async checkICMStages() {
    this.logger.info('Cron job triggered: ICM status check');

    try {
      await this.icmStageQueueService.checkICMStages();
      this.logger.info('ICM stage check enqueued');
    } catch (error) {
      this.logger.error({ error }, 'Failed to enqueue ICM stage check');
    }
  }
}
