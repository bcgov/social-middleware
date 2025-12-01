import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import {
  ApplicationPackageSubType,
  ApplicationPackageSubSubType,
  ReferralState,
} from '../enums/application-package-subtypes.enum';
import {
  ApplicationPackageStatus,
  ServiceRequestStage,
} from '../enums/application-package-status.enum';
import { SubmissionStatus } from '../enums/submission-status.enum';

export type ApplicationPackageDocument = ApplicationPackage & Document;

@Schema({ timestamps: true })
export class ApplicationPackage {
  @Prop({ required: true, unique: true })
  applicationPackageId!: string;

  @Prop({ required: true })
  userId!: string;

  @Prop({
    required: true,
    enum: ApplicationPackageSubType,
    default: ApplicationPackageSubType.FCH,
  })
  subtype!: ApplicationPackageSubType;

  @Prop({
    required: true,
    enum: ApplicationPackageSubSubType,
    default: ApplicationPackageSubSubType.FCH,
  })
  subsubtype!: ApplicationPackageSubSubType;

  @Prop({ required: false })
  srId!: string;

  @Prop({ required: false })
  srStage!: ServiceRequestStage;

  @Prop({
    required: true,
    enum: ApplicationPackageStatus,
  })
  status!: ApplicationPackageStatus;

  //TODO: Remove ReferralState
  @Prop({
    required: true,
    enum: ReferralState,
    default: ReferralState.NEW,
  })
  referralstate!: ReferralState;

  @Prop({ required: false, default: null })
  hasPartner!: string;

  @Prop({ required: false, default: null })
  hasHousehold!: string;

  //TODO: Remove hasSupportNetwork once we receive confirmation we will no longer collect it.
  @Prop({ required: false, default: null })
  hasSupportNetwork!: string;

  @Prop({ required: false, default: () => Date() })
  createdAt!: Date;

  @Prop({ required: false, default: null })
  submittedAt!: Date;

  @Prop({ required: false, default: 0 })
  submissionAttempts!: number; // track how many times we've tried to submit

  @Prop({ required: false, default: null })
  lastSubmissionAttempt!: Date; // when was the last attempt

  @Prop({ required: false, default: null })
  lastSubmissionError!: string; // error message from the last failed attempt

  @Prop({
    required: false,
    enum: SubmissionStatus,
    default: SubmissionStatus.PENDING,
  })
  submissionStatus!: string;

  @Prop({ required: false, default: () => Date() })
  updatedAt!: Date;
}

export const ApplicationPackageSchema =
  SchemaFactory.createForClass(ApplicationPackage);
