import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { Attachment, AttachmentSchema } from './schemas/attachment.schema';
import { SessionUtil } from '../common/utils/session.util';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Attachment.name, schema: AttachmentSchema },
    ]),
  ],
  controllers: [AttachmentsController],
  providers: [AttachmentsService, SessionUtil],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
