import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { ChesService } from './services/ches.service';
import { NotificationService } from './services/notification.service';
import { NotificationQueueModule } from './queue/notification-queue.module';
import { NotificationProcessor } from './queue/notification.processor';

@Module({
  imports: [HttpModule, ConfigModule, NotificationQueueModule],
  providers: [ChesService, NotificationService, NotificationProcessor],
  exports: [NotificationService, NotificationQueueModule],
})
export class NotificationModule {}
