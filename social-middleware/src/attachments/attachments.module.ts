import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ApplicationFormModule } from '../application-form/application-form.module';
import { AuthModule } from '../auth/auth.module';
import { SessionUtil } from '../common/utils/session.util';
import { HouseholdModule } from '../household/household.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { Attachment, AttachmentSchema } from './schemas/attachment.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Attachment.name, schema: AttachmentSchema },
    ]),
    HouseholdModule,
    AuthModule,
    ApplicationFormModule,
  ],
  controllers: [AttachmentsController],
  providers: [AttachmentsService, SessionUtil],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
