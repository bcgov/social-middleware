import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ApplicationFormType } from '../enums/application-form-types.enum';
//import { ApplicationFormStatus } from '../enums/application-form-status.enum';

export type FormParametersDocument = FormParameters & Document;

@Schema({ timestamps: true })
export class FormParameters {
  @Prop({ required: true })
  applicationId!: string;

  @Prop({ required: true, enum: ApplicationFormType })
  type!: ApplicationFormType;

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
