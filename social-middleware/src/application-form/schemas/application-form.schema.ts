import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ApplicationFormType } from '../enums/application-form-types.enum';
import { ApplicationFormStatus } from '../enums/application-form-status.enum';

export type ApplicationFormDocument = ApplicationForm & Document;

@Schema({ timestamps: true })
export class ApplicationForm {
  @Prop({ required: true, unique: true })
  applicationFormId!: string;

  @Prop({ required: true, unique: false })
  applicationPackageId!: string;

  @Prop({ required: false })
  userId!: string;

  @Prop({
    enum: ApplicationFormType,
    required: true,
  })
  type!: ApplicationFormType;

  @Prop({
    required: true,
    enum: ApplicationFormStatus,
    default: ApplicationFormStatus.NEW,
  })
  status!: ApplicationFormStatus;

  @Prop({ type: Object, default: null }) // Allows storing raw JSON
  formData!: Record<string, unknown> | null;

  @Prop({ default: Date.now })
  submittedAt!: Date;

  @Prop({ default: Date.now })
  createdAt!: Date;

  @Prop({ default: Date.now })
  updatedAt!: Date;
}

export const ApplicationFormSchema =
  SchemaFactory.createForClass(ApplicationForm);
