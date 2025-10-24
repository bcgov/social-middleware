import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FormsController } from './forms.controller';
import { FormsService } from './forms.service';
//import { ApplicationModule } from 'src/application/application.module';
import { ApplicationFormModule } from '../application-form/application-form.module';
import {
  FormParameters,
  FormParametersSchema,
} from '../application-form/schemas/form-parameters.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FormParameters.name, schema: FormParametersSchema },
    ]),
    ApplicationFormModule,
  ],
  controllers: [FormsController],
  providers: [FormsService],
})
export class FormsModule {}
