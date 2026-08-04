import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { AccessCodeType } from '../enums/access-code-type.enum';

export type ScreeningAccessCodeDocument = ScreeningAccessCode & Document;

@Schema({ timestamps: true })
export class ScreeningAccessCode {
  @Prop({ required: true, unique: true })
  accessCode!: string;

  @Prop({
    required: true,
    enum: AccessCodeType,
    default: AccessCodeType.SCREENING,
  })
  type!: AccessCodeType;

  @Prop({ required: false })
  applicationPackageId?: string; // reference to parent caregiver application

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
