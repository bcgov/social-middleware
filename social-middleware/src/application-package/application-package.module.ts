import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ApplicationPackageController } from './application-package.controller';
import { ApplicationPackageService } from './application-package.service';
import {
  ApplicationPackage,
  ApplicationPackageSchema,
} from './schema/application-package.schema';
import { ApplicationFormModule } from '../application-form/application-form.module';
import { HouseholdModule } from '../household/household.module';
import { AuthModule } from '../auth/auth.module';
import { SiebelModule } from '../siebel/siebel.module';
import { SessionUtil } from 'src/common/utils/session.util';
import { UserUtil } from '../common/utils/user.util';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: ApplicationPackage.name,
        schema: ApplicationPackageSchema,
      },
    ]),
    ApplicationFormModule,
    HouseholdModule,
    AuthModule,
    SiebelModule,
  ],
  controllers: [ApplicationPackageController],
  providers: [ApplicationPackageService, SessionUtil, UserUtil],
  exports: [ApplicationPackageService],
})
export class ApplicationPackageModule {}
