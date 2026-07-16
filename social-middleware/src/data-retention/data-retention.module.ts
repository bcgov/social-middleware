import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  FormParameters,
  FormParametersSchema,
} from '../application-form/schemas/form-parameters.schema';
import {
  ScreeningAccessCode,
  ScreeningAccessCodeSchema,
} from '../household/schemas/screening-access-code.schema';
import {
  ApplicationPackage,
  ApplicationPackageSchema,
} from '../application-package/schema/application-package.schema';
import {
  HouseholdMembers,
  HouseholdMembersSchema,
} from '../household/schemas/household-members.schema';
import {
  ApplicationForm,
  ApplicationFormSchema,
} from '../application-form/schemas/application-form.schema';
import {
  Attachment,
  AttachmentSchema,
} from 'src/attachments/schemas/attachment.schema';
import { DataRetentionSchedulerService } from './data-retention-scheduler.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FormParameters.name, schema: FormParametersSchema },
      { name: ScreeningAccessCode.name, schema: ScreeningAccessCodeSchema },
      { name: ApplicationPackage.name, schema: ApplicationPackageSchema },
      { name: HouseholdMembers.name, schema: HouseholdMembersSchema },
      { name: ApplicationForm.name, schema: ApplicationFormSchema },
      { name: Attachment.name, schema: AttachmentSchema },
    ]),
  ],
  providers: [DataRetentionSchedulerService],
})
export class DataRetentionModule {}
