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
import { SessionUtil } from 'src/common/utils/session.util';

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
  ],
  controllers: [ApplicationPackageController],
  providers: [ApplicationPackageService, SessionUtil],
  exports: [ApplicationPackageService],
})
export class ApplicationPackageModule {}
