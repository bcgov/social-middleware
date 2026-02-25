import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { IcmStageQueueService } from './icm-stage-queue.service';

@Module({
  imports: [
    BullModule.registerQueueAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      name: 'icmStageQueue',
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get<string>('REDIS_HOST'),
          port: Number(configService.get<string>('REDIS_PORT')),
          password: configService.get<string>('REDIS_PASSWORD'),
          maxRetriesPerRequest: null, // Don't timeout individual commands
          enableReadyCheck: false, // Don't wait for Redis READY state
          retryStrategy: (times) => {
            const delay = Math.min(times * 50, 2000);
            return delay; // Retry connection with backoff
          },
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 10000 },
          removeOnComplete: 100,
          removeOnFail: false,
        },
      }),
    }),
  ],
  providers: [IcmStageQueueService],
  exports: [IcmStageQueueService, BullModule],
})
export class IcmStageQueueModule {}
