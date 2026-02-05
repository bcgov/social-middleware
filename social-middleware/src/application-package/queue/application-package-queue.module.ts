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
import { AuthModule } from '../../auth/auth.module';
import { SiebelModule } from '../../siebel/siebel.module';
import { NotificationModule } from '../../notifications/notification.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [
    BullModule.registerQueueAsync({
      imports: [ConfigModule, AuthModule],
      inject: [ConfigService],
      name: 'applicationPackageQueue',
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get<string>('REDIS_HOST'),
          port: Number(configService.get<string>('REDIS_PORT')),
          maxRetriesPerRequest: null, // Don't timeout individual commands
          enableReadyCheck: false, // Don't wait for Redis READY state
          retryStrategy: (times) => {
            const delay = Math.min(times * 50, 2000);
            return delay; // Retry connection with backoff
          },
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
    AuthModule,
    SiebelModule,
    NotificationModule,
    CommonModule,
    forwardRef(() => ApplicationPackageModule),
  ],
  providers: [
    ApplicationPackageQueueService,
    ApplicationPackageProcessor,
    FormCompletedListener,
  ],
  exports: [ApplicationPackageQueueService, BullModule],
})
export class ApplicationPackageQueueModule {}
