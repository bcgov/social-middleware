import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HouseholdController } from './household.controller';
import { HouseholdService } from './household.service';
import {
  HouseholdMembers,
  HouseholdMembersSchema,
} from './schemas/household-members.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HouseholdMembers.name, schema: HouseholdMembersSchema },
    ]),
  ],
  controllers: [HouseholdController],
  providers: [HouseholdService],
  exports: [HouseholdService],
})
export class HouseholdModule {}
