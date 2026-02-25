import { Module } from '@nestjs/common';
import { BullDashboardService } from './bull-dashboard.service';
//import { ApplicationQueueModule } from '../application/queue/application-queue.module';
import { ApplicationPackageQueueModule } from '../application-package/queue/application-package-queue.module';
import { IcmStageQueueModule } from '../application-package/queue/icm-stage-queue.module';
import { NotificationQueueModule } from '../notifications/queue/notification-queue.module';

@Module({
  imports: [
    ApplicationPackageQueueModule,
    IcmStageQueueModule,
    NotificationQueueModule,
  ],
  providers: [BullDashboardService],
  exports: [BullDashboardService],
})
export class BullDashboardModule {}
