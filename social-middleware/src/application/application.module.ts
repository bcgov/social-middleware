import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Application, ApplicationSchema } from './schemas/application.schema';
import {
  FormParameters,
  FormParametersSchema,
} from './schemas/form-parameters.schema';
import { ApplicationService } from './application.service';
import { ApplicationController } from './application.controller';
import { HouseholdModule } from 'src/household/household.module';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Application.name, schema: ApplicationSchema },
      { name: FormParameters.name, schema: FormParametersSchema },
    ]),
    HouseholdModule,
    AuthModule
  ],
  exports: [MongooseModule],
  controllers: [ApplicationController],
  providers: [ApplicationService],
})
export class ApplicationModule {}
