import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CommonModule } from '../common/common.module';
import { SiebelModule } from '../siebel/siebel.module';
import { MongooseModule } from '@nestjs/mongoose';
import { ResourceCaseController } from './resource-case.controller';
import { ResourceCaseService } from './resource-case.service';

import {
  HouseholdContact,
  HouseholdContactSchema,
} from './schema/household-contact.schema';
import { HouseholdContactService } from './household-contact.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HouseholdContact.name, schema: HouseholdContactSchema },
    ]),
    AuthModule,
    SiebelModule,
    CommonModule,
  ],
  controllers: [ResourceCaseController],
  providers: [ResourceCaseService, HouseholdContactService],
  exports: [ResourceCaseService, HouseholdContactService],
})
export class ResourceCaseModule {}
