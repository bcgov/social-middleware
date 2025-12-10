import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from 'src/auth/auth.module';
import { HouseholdModule } from 'src/household/household.module';
import {
  ApplicationPackage,
  ApplicationPackageSchema,
} from 'src/application-package/schema/application-package.schema';
import { ApplicationPackageService } from './application-package.service';
import { ApplicationPackageController } from './application-package.controller';
import { ApplicationPackageQueueModule } from './queue/application-package-queue.module';
import { ApplicationPackageSchedulerService } from './application-package-scheduler.service';
import { ApplicationFormModule } from '../application-form/application-form.module';
import { SiebelModule } from '../siebel/siebel.module';
import { CommonModule } from '../common/common.module';
import { AuthListener } from './listeners/auth.listener';
import { AttachmentsModule } from '../attachments/attachments.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ApplicationPackage.name, schema: ApplicationPackageSchema },
    ]),
    ApplicationFormModule,
    HouseholdModule,
    AuthModule,
    SiebelModule,
    CommonModule,
    AttachmentsModule,
    forwardRef(() => ApplicationPackageQueueModule),
  ],
  controllers: [ApplicationPackageController],
  providers: [
    ApplicationPackageService,
    AuthListener,
    ApplicationPackageSchedulerService,
  ],
  exports: [ApplicationPackageService, ApplicationFormModule, HouseholdModule],
})
export class ApplicationPackageModule {}
