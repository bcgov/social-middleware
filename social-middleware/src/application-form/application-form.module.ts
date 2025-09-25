import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ApplicationFormService } from './services/application-form.service';
import {
  ApplicationForm,
  ApplicationFormSchema,
} from './schemas/application-form.schema';
import {
  FormParameters,
  FormParametersSchema,
} from './schemas/form-parameters.schema';
import { AuthModule } from 'src/auth/auth.module';
import { AccessCodeService } from './services/access-code.service';
import {
  ApplicationPackage,
  ApplicationPackageSchema,
} from 'src/application-package/schema/application-package.schema';
import {
  ScreeningAccessCode,
  ScreeningAccessCodeSchema,
} from './schemas/screening-access-code.schema';
import { HouseholdModule } from 'src/household/household.module';
import { ApplicationFormsController } from './application-form.controller';
import { SessionUtil } from '../common/utils/session.util';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ApplicationForm.name, schema: ApplicationFormSchema },
      { name: FormParameters.name, schema: FormParametersSchema },
      { name: ApplicationPackage.name, schema: ApplicationPackageSchema },
      { name: ScreeningAccessCode.name, schema: ScreeningAccessCodeSchema },
    ]),
    AuthModule, // For UserService dependency
    HouseholdModule,
  ],
  exports: [ApplicationFormService, AccessCodeService], // Export so other modules can use it
  controllers: [ApplicationFormsController],
  providers: [ApplicationFormService, SessionUtil, AccessCodeService],
})
export class ApplicationFormModule {}
