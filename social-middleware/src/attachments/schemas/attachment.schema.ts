import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { AttachmentType } from '../enums/attachment-types.enum';

export type AttachmentDocument = Attachment & Document;

@Schema({ timestamps: true })
export class Attachment {
  @Prop({ required: true, unique: true, type: String, default: uuidv4 })
  attachmentId!: string;

  @Prop({ required: true, type: String })
  applicationPackageId!: string;

  @Prop({ required: false, type: String, default: null })
  householdMemberId!: string | null;

  @Prop({ required: false, type: String, default: null })
  applicationFormId!: string | null;

  @Prop({ required: true, enum: Object.values(AttachmentType) })
  attachmentType!: AttachmentType;

  @Prop({ required: true, type: String })
  fileName!: string;

  @Prop({ required: true, type: String })
  fileType!: string; // MIME type

  @Prop({ required: true, type: Number })
  fileSize!: number;

  @Prop({ required: true, type: String })
  fileData!: string; // base64 encoded file content

  @Prop({ required: false, type: String })
  description?: string; // probably won't use..

  @Prop({ required: true, type: String })
  uploadedBy!: string; // userId

  @Prop({ required: false, type: String, default: null })
  icmAttachmentId!: string | null; // once we upload to ICM, we track the icmAttachmentID

  createdAt!: Date;
  updatedAt!: Date;
  sentToICMAt!: Date;
}

export const AttachmentSchema = SchemaFactory.createForClass(Attachment);
