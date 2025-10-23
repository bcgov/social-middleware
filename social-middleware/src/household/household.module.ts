import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HouseholdController } from './household.controller';
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
  ],
  controllers: [HouseholdController],
  providers: [HouseholdService, AccessCodeService],
  exports: [HouseholdService, AccessCodeService],
})
export class HouseholdModule {}
