import { Module } from '@nestjs/common';
import { BullDashboardService } from './bull-dashboard.service';
import { ApplicationQueueModule } from '../application/queue/application-queue.module';

@Module({
  imports: [ApplicationQueueModule],
  providers: [BullDashboardService],
  exports: [BullDashboardService],
})
export class BullDashboardModule {}
