import {
  Processor,
  Process,
  OnQueueCompleted,
  OnQueueFailed,
} from '@nestjs/bull';
import { Job } from 'bull';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ChesService } from '../services/ches.service';
import { SendEmailDto } from '../dto/send-email.dto';

@Injectable()
@Processor('notificationQueue')
export class NotificationProcessor {
  constructor(
    private readonly chesService: ChesService,
    @InjectPinoLogger(NotificationProcessor.name)
    private readonly logger: PinoLogger,
  ) {}

  @Process('send-email')
  async handleSendEmail(job: Job<SendEmailDto>): Promise<{ messages: any[] }> {
    this.logger.info(
      { jobId: job.id, to: job.data.to, subject: job.data.subject },
      'Processing email send',
    );

    try {
      const result = await this.chesService.sendEmail(job.data);

      this.logger.info(
        {
          jobId: job.id,
          messages: result.messages,
        },
        'Email sent successfully',
      );

      return { messages: result.messages };
    } catch (error) {
      this.logger.error({ jobId: job.id, error }, 'Failed to send email');
      throw error;
    }
  }

  @OnQueueCompleted()
  onCompleted(job: Job, result: unknown) {
    this.logger.info(
      {
        jobId: job.id,
        result,
      },
      'Email job completed',
    );
  }
  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(
      {
        jobId: job.id,
        error: error.message,
        attemptsMade: job.attemptsMade,
      },
      'Email job failed',
    );
  }
}
