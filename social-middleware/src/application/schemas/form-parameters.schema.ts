import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { FormType } from '../enums/form-type.enum';

export type FormParametersDocument = FormParameters & Document;

@Schema({ timestamps: true })
export class FormParameters {
  @Prop({ required: true })
  applicationFormId!: string;

  @Prop({ required: true, enum: FormType })
  type!: FormType;

  @Prop({ required: true })
  formId!: string;

  @Prop({ required: true, unique: true })
  formAccessToken!: string;

  @Prop({ type: Object, default: {} })
  formParameters!: Record<string, any>;

  // Adding these so TS knows they exist and can be used later
  createdAt!: Date;
  updatedAt!: Date;
}

export const FormParametersSchema =
  SchemaFactory.createForClass(FormParameters);
