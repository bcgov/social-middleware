import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ApplicationPackageController } from './application-package.controller';
import { ApplicationPackageService } from './application-package.service';
import {
  ApplicationPackage,
  ApplicationPackageSchema,
} from './schema/application-package.schema';
import { ApplicationFormModule } from '../application-form/application-form.module';
import { SessionUtil } from 'src/common/utils/session.util';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: ApplicationPackage.name,
        schema: ApplicationPackageSchema,
      },
    ]),
    ApplicationFormModule, // Since you're using ApplicationFormService
  ],
  controllers: [ApplicationPackageController], // Make sure this is here
  providers: [ApplicationPackageService, SessionUtil], // Make sure SessionUtil is here
  exports: [ApplicationPackageService],
})
export class ApplicationPackageModule {}
