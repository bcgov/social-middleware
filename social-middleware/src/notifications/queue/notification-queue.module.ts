import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationQueueService } from './notification-queue.service';

@Module({
  imports: [
    BullModule.registerQueueAsync({
      imports: [],
      inject: [ConfigService],
      name: 'notificationQueue',
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get<string>('REDIS_HOST'),
          port: Number(configService.get<string>('REDIS_PORT')),
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: 100,
          removeOnFail: false,
        },
      }),
    }),
    ConfigModule,
  ],
  providers: [NotificationQueueService],
  exports: [NotificationQueueService, BullModule],
})
export class NotificationQueueModule {}
