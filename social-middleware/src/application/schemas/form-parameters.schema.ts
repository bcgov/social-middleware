import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type FormParametersDocument = FormParameters & Document;

@Schema({ timestamps: true })
export class FormParameters {
  @Prop({ required: true })
  applicationId!: string;

  @Prop({ required: true })
  type!: 'Create' | 'Read' | 'Update';

  @Prop({ required: true })
  formId!: string;

  @Prop({ required: true, unique: true })
  formAccessToken!: string;

  @Prop({ type: Object, default: {} })
  formParameters!: Record<string, any>;
}

export const FormParametersSchema = SchemaFactory.createForClass(FormParameters);
