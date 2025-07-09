/* eslint-disable prettier/prettier */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type FormParametersDocument = FormParameters & Document;

@Schema({ timestamps: true })
export class FormParameters {
  @Prop({ required: true, unique: true })
  token!: string;

  @Prop({ required: true, enum: ['create', 'read', 'update'] })
  type!: 'create' | 'read' | 'update';

  @Prop({ type: Object, required: true })
  params!: Record<string, any>;

  @Prop({ required: true })
  application!: string;// this should refer to Application Record in DB.

  @Prop({ default: false })
  expiredForUrl!: boolean;
}

export const FormParametersSchema = SchemaFactory.createForClass(FormParameters);
