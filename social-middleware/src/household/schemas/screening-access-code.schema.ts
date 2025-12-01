import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ScreeningAccessCodeDocument = ScreeningAccessCode & Document;

@Schema({ timestamps: true })
export class ScreeningAccessCode {
  @Prop({ required: true, unique: true })
  accessCode!: string;

  @Prop({ required: true })
  applicationPackageId!: string; // reference to parent caregiver application

  // removed
  //@Prop({ required: true })
  //applicationFormId!: string; // reference to screening application

  @Prop({ required: true })
  householdMemberId!: string; // reference to household member record

  @Prop({ required: false })
  assignedUserId?: string; // reference to user record, once they have authenticated

  @Prop({ default: false })
  isUsed!: boolean;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop({ default: 0 })
  attemptCount!: number;

  @Prop({ default: 3 })
  maxAttempts!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ScreeningAccessCodeSchema =
  SchemaFactory.createForClass(ScreeningAccessCode);
