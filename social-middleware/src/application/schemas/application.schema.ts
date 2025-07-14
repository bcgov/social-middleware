import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ApplicationDocument = Application & Document;

@Schema({ timestamps: true })
export class Application {
  @Prop({ required: true, unique: true })
  applicationId!: string;

  @Prop({ required: true })
  userId!: string;

  @Prop({ required: true })
  type!: string;

  @Prop({ required: true })
  status!: string; // e.g., 'Pending', 'Submitted', etc.

  @Prop({ type: Object, default: null }) // Allows storing raw JSON
  formData!: Record<string, any> | null;
}

export const ApplicationSchema = SchemaFactory.createForClass(Application);
