import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ApplicationQueueService } from './application-queue.service';
import { ApplicationProcessor } from './application.processor';
import { Application, ApplicationSchema } from '../schemas/application.schema';
import {
  FormParameters,
  FormParametersSchema,
} from '../schemas/form-parameters.schema';
import { HouseholdModule } from 'src/household/household.module';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [
    BullModule.registerQueueAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      name: 'applicationQueue',
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get<string>('REDIS_HOST'),
          port: Number(configService.get<string>('REDIS_PORT')),
        },
        defaultJobOptions: {
          attempts: Number(configService.get<string>('QUEUE_JOB_ATTEMPTS')),
          backoff: {
            type: 'fixed',
            delay: Number(configService.get<string>('QUEUE_BACKOFF_DELAY')),
          },
        },
      }),
    }),
    MongooseModule.forFeature([
      { name: Application.name, schema: ApplicationSchema },
      { name: FormParameters.name, schema: FormParametersSchema },
    ]),
    HouseholdModule,
    AuthModule,
  ],
  providers: [ApplicationQueueService, ApplicationProcessor],
  exports: [ApplicationQueueService, BullModule],
})
export class ApplicationQueueModule {}
