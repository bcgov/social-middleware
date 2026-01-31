import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { MongooseModule } from '@nestjs/mongoose';
import { IcmStageQueueService } from './icm-stage-queue.service';
import { IcmStageProcessor } from './icm-stage.processor';
import { SiebelModule } from '../../siebel/siebel.module';
import {
  ApplicationPackage,
  ApplicationPackageSchema,
} from '../schema/application-package.schema';

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
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 10000,
          },
          removeOnComplete: 100,
          removeOnFail: false,
        },
      }),
    }),
    MongooseModule.forFeature([
      { name: ApplicationPackage.name, schema: ApplicationPackageSchema },
    ]),
    HttpModule,
    ConfigModule,
    SiebelModule,
  ],
  providers: [IcmStageQueueService, IcmStageProcessor],
  exports: [IcmStageQueueService, BullModule],
})
export class IcmStageQueueModule {}
