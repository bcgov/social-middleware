import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { MongooseModule } from '@nestjs/mongoose';
import { ApplicationQueueService } from './application-queue.service';
import { ApplicationProcessor } from './application.processor';
import { Application, ApplicationSchema } from '../schemas/application.schema';
import {
  FormParameters,
  FormParametersSchema,
} from '../schemas/form-parameters.schema';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'applicationQueue',
    }),
    MongooseModule.forFeature([
      { name: Application.name, schema: ApplicationSchema },
      { name: FormParameters.name, schema: FormParametersSchema },
    ]),
  ],
  providers: [ApplicationQueueService, ApplicationProcessor],
  exports: [ApplicationQueueService, BullModule],
})
export class ApplicationQueueModule {}
