import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ApplicationPackageModule } from '../application-package.module';
import { ApplicationPackageQueueService } from './application-package-queue.service';
import { ApplicationPackageProcessor } from './application-package.processor';
import {
  ApplicationPackage,
  ApplicationPackageSchema,
} from '../schema/application-package.schema';
import { FormCompletedListener } from './form-completed.listener';

@Module({
  imports: [
    BullModule.registerQueueAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      name: 'applicationPackageQueue',
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get<string>('REDIS_HOST'),
          port: Number(configService.get<string>('REDIS_PORT')),
        },
        defaultJobOptions: {
          attempts: 16,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: 100,
          removeOnFail: false,
        },
      }),
    }),
    MongooseModule.forFeature([
      { name: ApplicationPackage.name, schema: ApplicationPackageSchema },
    ]),
    forwardRef(() => ApplicationPackageModule), // Only this one!
  ],
  providers: [
    ApplicationPackageQueueService,
    ApplicationPackageProcessor,
    FormCompletedListener,
  ],
  exports: [ApplicationPackageQueueService, BullModule],
})
export class ApplicationPackageQueueModule {}
