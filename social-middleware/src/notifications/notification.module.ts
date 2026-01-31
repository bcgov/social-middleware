import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { ChesService } from './services/ches.service';
import { NotificationService } from './services/notification.service';

@Module({
  imports: [HttpModule, ConfigModule],
  providers: [ChesService, NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
