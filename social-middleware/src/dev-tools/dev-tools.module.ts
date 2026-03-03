import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { DevToolsController } from './dev-tools.controller';
import { DevToolsService } from './dev-tools.service';
import { User, UserSchema } from '../auth/schemas/user.schema';
import {
  ApplicationPackage,
  ApplicationPackageSchema,
} from '../application-package/schema/application-package.schema';
import {
  ApplicationForm,
  ApplicationFormSchema,
} from '../application-form/schemas/application-form.schema';
import { HouseholdModule } from 'src/household/household.module';
import {
  FormParameters,
  FormParametersSchema,
} from '../application-form/schemas/form-parameters.schema';
import {
  ScreeningAccessCode,
  ScreeningAccessCodeSchema,
} from '../household/schemas/screening-access-code.schema';
import { ApplicationPackageModule } from '../application-package/application-package.module';
@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: ApplicationPackage.name, schema: ApplicationPackageSchema },
      { name: ApplicationForm.name, schema: ApplicationFormSchema },
      { name: FormParameters.name, schema: FormParametersSchema },
      { name: ScreeningAccessCode.name, schema: ScreeningAccessCodeSchema },
    ]),
    HouseholdModule,
    ApplicationPackageModule,
  ],
  controllers: [DevToolsController],
  providers: [DevToolsService],
})
export class DevToolsModule {}
