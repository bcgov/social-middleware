import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ApplicationFormService } from '../application-form/services/application-form.service';
import { AccessCodeService } from '../application-form/services/access-code.service';
import { AuthModule } from 'src/auth/auth.module';
import { HouseholdModule } from 'src/household/household.module';

import {
  ApplicationForm,
  ApplicationFormSchema,
} from '../application-form/schemas/application-form.schema';
import {
  FormParameters,
  FormParametersSchema,
} from '../application-form/schemas/form-parameters.schema';
import {
  ApplicationPackage,
  ApplicationPackageSchema,
} from 'src/application-package/schema/application-package.schema';
import {
  ScreeningAccessCode,
  ScreeningAccessCodeSchema,
} from '../application-form/schemas/screening-access-code.schema';
import { ApplicationFormModule } from '../application-form/application-form.module';
import { SiebelModule } from '../siebel/siebel.module';
import { SessionUtil } from 'src/common/utils/session.util';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ApplicationForm.name, schema: ApplicationFormSchema },
      { name: FormParameters.name, schema: FormParametersSchema },
      { name: ApplicationPackage.name, schema: ApplicationPackageSchema },
      { name: ScreeningAccessCode.name, schema: ScreeningAccessCodeSchema },
    ]),
    AuthModule,
    HouseholdModule,
    SiebelModule,
    ApplicationFormModule,
  ],
  providers: [ApplicationFormService, AccessCodeService, SessionUtil],
  exports: [
    ApplicationFormService,
    AccessCodeService,
    MongooseModule.forFeature([
      { name: ApplicationForm.name, schema: ApplicationFormSchema },
      { name: FormParameters.name, schema: FormParametersSchema },
      { name: ApplicationPackage.name, schema: ApplicationPackageSchema },
      { name: ScreeningAccessCode.name, schema: ScreeningAccessCodeSchema },
    ]),
  ],
})
export class ApplicationPackageModule {}
