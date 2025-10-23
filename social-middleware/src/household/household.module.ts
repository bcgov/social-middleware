import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HouseholdController } from './household.controller';
import { HouseholdAccessCodeController } from './household-access.controller';
import { SessionUtil } from '../common/utils/session.util';
import { AuthModule } from '../auth/auth.module';
import { HouseholdService } from './services/household.service';
import { AccessCodeService } from './services/access-code.service';
import {
  HouseholdMembers,
  HouseholdMembersSchema,
} from './schemas/household-members.schema';
import {
  ApplicationForm,
  ApplicationFormSchema,
} from '../application-form/schemas/application-form.schema';
import {
  ScreeningAccessCode,
  ScreeningAccessCodeSchema,
} from './schemas/screening-access-code.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HouseholdMembers.name, schema: HouseholdMembersSchema },
      { name: ApplicationForm.name, schema: ApplicationFormSchema },
      { name: ScreeningAccessCode.name, schema: ScreeningAccessCodeSchema },
    ]),
    AuthModule,
  ],
  controllers: [HouseholdController, HouseholdAccessCodeController],
  providers: [HouseholdService, AccessCodeService, SessionUtil],
  exports: [HouseholdService, AccessCodeService],
})
export class HouseholdModule {}
