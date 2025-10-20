import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ApplicationSubmissionStatus } from '../enums/application-submission-status.enum';
//import { ApplicationTypes } from '../enums/application-types.enum';

export type ApplicationSubmissionDocument = ApplicationSubmission & Document;

@Schema({ timestamps: true })
export class ApplicationSubmission {
  @Prop({ required: true, unique: true })
  applicationId!: string;

  @Prop({ required: false })
  applicationFormIsComplete!: boolean;

  @Prop({ required: false })
  screeningFormIsComplete!: boolean;

  @Prop({
    required: true,
    enum: ApplicationSubmissionStatus,
    default: ApplicationSubmissionStatus.Draft,
  })
  status!: ApplicationSubmissionStatus;

  @Prop({ required: false, default: null })
  hasSpouse!: boolean;

  @Prop({ required: false, default: null })
  isSpouseComplete!: boolean;

  @Prop({ required: false, default: null })
  hasNonCaregiverAdults!: boolean;

  @Prop({ required: false, default: null })
  numberOfIncompleteNonCaregiverAdults!: number;

  @Prop({ required: false, default: null })
  submittedAt!: Date;

  @Prop({ required: false, default: () => Date() })
  updatedAt!: Date;
}

export const ApplicationSubmissionSchema = SchemaFactory.createForClass(
  ApplicationSubmission,
);
