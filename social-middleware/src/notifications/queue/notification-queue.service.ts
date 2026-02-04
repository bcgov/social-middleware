import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { SendEmailDto } from '../dto/send-email.dto';

@Injectable()
export class NotificationQueueService {
  constructor(
    @InjectQueue('notificationQueue') private readonly notificationQueue: Queue,
    @InjectPinoLogger(NotificationQueueService.name)
    private readonly logger: PinoLogger,
  ) {}

  async sendEmail(emailData: SendEmailDto): Promise<void> {
    try {
      this.logger.info(
        { to: emailData.to, subject: emailData.subject },
        'Enqueueing email',
      );
      const job = await this.notificationQueue.add('send-email', emailData);
      this.logger.info({ jobId: job.id }, 'Email job enqueued successfully');
    } catch (error) {
      this.logger.error({ error }, 'Failed to enqueue email');
      throw error;
    }
  }
}
