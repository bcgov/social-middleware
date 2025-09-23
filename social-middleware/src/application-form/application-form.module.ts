import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ApplicationFormService } from './application-form.service';
import {
  ApplicationForm,
  ApplicationFormSchema,
} from './schemas/application-form.schema';
import {
  FormParameters,
  FormParametersSchema,
} from './schemas/form-parameters.schema';
import { AuthModule } from 'src/auth/auth.module';
import { ApplicationFormsController } from './application-form.controller';
import { SessionUtil } from '../common/utils/session.util';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ApplicationForm.name, schema: ApplicationFormSchema },
      { name: FormParameters.name, schema: FormParametersSchema },
    ]),
    AuthModule, // For UserService dependency
  ],
  controllers: [ApplicationFormsController],
  providers: [ApplicationFormService, SessionUtil],
  exports: [ApplicationFormService], // Export so other modules can use it
})
export class ApplicationFormModule {}
