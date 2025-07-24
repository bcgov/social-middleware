import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { DevToolsController } from './dev-tools.controller';
import { DevToolsService } from './dev-tools.service';

import {
  Application,
  ApplicationSchema,
} from '../application/schemas/application.schema';
import {
  FormParameters,
  FormParametersSchema,
} from '../application/schemas/form-parameters.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Application.name, schema: ApplicationSchema },
      { name: FormParameters.name, schema: FormParametersSchema },
    ]),
  ],
  controllers: [DevToolsController],
  providers: [DevToolsService],
})
export class DevToolsModule {}
