import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { DevToolsController } from './dev-tools.controller';
import { DevToolsService } from './dev-tools.service';
import { User, UserSchema } from '../auth/schemas/user.schema';
import { HouseholdModule } from 'src/household/household.module';
import {
  Application,
  ApplicationSchema,
} from '../application/schemas/application.schema';
import {
  FormParameters,
  FormParametersSchema,
} from '../application/schemas/form-parameters.schema';
import {
  ScreeningAccessCode,
  ScreeningAccessCodeSchema,
} from 'src/application/schemas/screening-access-code.schema';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Application.name, schema: ApplicationSchema },
      { name: FormParameters.name, schema: FormParametersSchema },
      { name: ScreeningAccessCode.name, schema: ScreeningAccessCodeSchema },
    ]),
    HouseholdModule,
  ],
  controllers: [DevToolsController],
  providers: [DevToolsService],
})
export class DevToolsModule {}
