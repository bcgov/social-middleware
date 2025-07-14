import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Application, ApplicationSchema } from './schemas/application.schema';
import { FormParameters, FormParametersSchema } from './schemas/form-parameters.schema';
import { ApplicationService } from './application.service';
import { ApplicationController } from './application.controller'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Application.name, schema: ApplicationSchema },
      { name: FormParameters.name, schema: FormParametersSchema },
    ]),
  ],
  controllers: [ApplicationController],
  providers: [ApplicationService],
})
export class ApplicationModule {}

