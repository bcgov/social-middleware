import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { FormCompletedEvent } from 'src/application-form/events/form-completed.event';
import { ApplicationPackageQueueService } from './application-package-queue.service';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

@Injectable()
export class FormCompletedListener {
  constructor(
    private readonly queueService: ApplicationPackageQueueService,
    @InjectPinoLogger(FormCompletedListener.name)
    private readonly logger: PinoLogger,
  ) {}

  @OnEvent('form.completed')
  async handleFormCompleted(event: FormCompletedEvent) {
    this.logger.info(
      {
        applicationFormId: event.applicationFormId,
        applicationPackageId: event.applicationPackageId,
        formType: event.formType,
      },
      'Form completed event received, enqueueing completeness check',
    );

    try {
      await this.queueService.enqueueCompletenessCheck(
        event.applicationPackageId,
      );
    } catch (error) {
      this.logger.error(
        { error, applicationPackageId: event.applicationPackageId },
        'Failed to enqueue completeness check from event',
      );
    }
  }
}
