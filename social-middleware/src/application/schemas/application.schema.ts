import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ApplicationStatus } from '../enums/application-status.enum';
import { ApplicationTypes } from '../enums/application-types.enum';

export type ApplicationDocument = Application & Document;

@Schema({ timestamps: true })
export class Application {
    @Prop({ required: true, unique: true })
    applicationId!: string;

    @Prop({ required: true })
    primary_applicantId!: string;

    @Prop({ enum: ApplicationTypes, default: ApplicationTypes.Sample })
    type!: ApplicationTypes;

    @Prop({ required: true, enum: ApplicationStatus, default: ApplicationStatus.Pending })
    status!: ApplicationStatus;

    @Prop({ type: Object, default: null }) // Allows storing raw JSON
    formData!: Record<string, any> | null;

    @Prop({ default: Date.now })
    submittedAt!: Date;

    updatedAt!: Date;
}

export const ApplicationSchema = SchemaFactory.createForClass(Application);
