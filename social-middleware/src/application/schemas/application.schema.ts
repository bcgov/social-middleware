import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ApplicationStatus } from '../enums/application-status.enum';

export type ApplicationDocument = Application & Document;

@Schema({ timestamps: true })
export class Application {
    @Prop({ required: true, unique: true })
    applicationId!: string;

    @Prop({ required: true })
    userId!: string;

    @Prop({ default: null })
    type!: string;

    @Prop({ required: true, enum: ApplicationStatus, default: ApplicationStatus.Pending })
    status!: ApplicationStatus;

    @Prop({ type: Object, default: null }) // Allows storing raw JSON
    formData!: Record<string, any> | null;
}

export const ApplicationSchema = SchemaFactory.createForClass(Application);
