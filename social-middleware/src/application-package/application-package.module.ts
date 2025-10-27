import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from 'src/auth/auth.module';
import { HouseholdModule } from 'src/household/household.module';
import {
  ApplicationPackage,
  ApplicationPackageSchema,
} from 'src/application-package/schema/application-package.schema';
import { ApplicationPackageService } from './application-package.service';
import { ApplicationPackageController } from './application-package.controller';
import { ApplicationFormModule } from '../application-form/application-form.module';
import { SiebelModule } from '../siebel/siebel.module';
import { CommonModule } from '../common/common.module';
//import { SessionUtil } from 'src/common/utils/session.util';
//import { UserUtil } from '../common/utils/user.util';
import { AuthListener } from './listeners/auth.listener';

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
  ],
  controllers: [ApplicationPackageController],
  providers: [ApplicationPackageService, AuthListener],
  exports: [ApplicationPackageService],
})
export class ApplicationPackageModule {}
