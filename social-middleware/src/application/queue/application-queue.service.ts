import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ApplicationStatus } from '../enums/application-status.enum';
import { ApplicationTypes } from '../enums/application-types.enum';

@Injectable()
export class ApplicationQueueService {
  constructor(@InjectQueue('applicationQueue') private queue: Queue) {}

  async enqueueSubmission(applicationId: string, type: ApplicationTypes) {
    await this.queue.add('submission', {
      applicationId,
      type,
      status: ApplicationStatus.Submitted,
    });
  }

  async enqueueUpdate(
    applicationId: string,
    type: ApplicationTypes,
    status: ApplicationStatus,
  ) {
    await this.queue.add('update', {
      applicationId,
      type,
      status,
    });
  }
}
