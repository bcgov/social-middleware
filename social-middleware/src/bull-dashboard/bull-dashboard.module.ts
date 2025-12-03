import { Module } from '@nestjs/common';
import { BullDashboardService } from './bull-dashboard.service';
import { ApplicationQueueModule } from '../application/queue/application-queue.module';
import { ApplicationPackageQueueModule } from '../application-package/queue/application-package-queue.module';

@Module({
  imports: [ApplicationQueueModule, ApplicationPackageQueueModule],
  providers: [BullDashboardService],
  exports: [BullDashboardService],
})
export class BullDashboardModule {}
