import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Application, ApplicationSchema } from './schemas/application.schema';
import { ApplicationQueueModule } from './queue/application-queue.module';
import {
  FormParameters,
  FormParametersSchema,
} from './schemas/form-parameters.schema';
import { ApplicationService } from './application.service';
import { ApplicationController } from './application.controller';
import { HouseholdModule } from 'src/household/household.module';
import { AuthModule } from 'src/auth/auth.module';
import { ApplicationSubmissionModule } from 'src/application-submission/application-submission.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Application.name, schema: ApplicationSchema },
      { name: FormParameters.name, schema: FormParametersSchema },
    ]),
    HouseholdModule,
    AuthModule,
    forwardRef(() => ApplicationSubmissionModule),
    ApplicationQueueModule,
  ],
  exports: [ApplicationService, MongooseModule],
  controllers: [ApplicationController],
  providers: [ApplicationService],
})
export class ApplicationModule {}
