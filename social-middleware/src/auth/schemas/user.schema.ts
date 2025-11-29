// auth/schemas/user.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { UserStatus } from '../enums/user-status.enum';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  id!: string;

  @Prop({ required: true, unique: true })
  bc_services_card_id!: string;

  @Prop({ required: true, default: '' })
  first_name!: string;

  @Prop({ required: false })
  last_name?: string;

  @Prop({ required: true })
  email!: string;

  @Prop({ required: false })
  dateOfBirth?: string;

  @Prop({ required: false })
  street_address?: string;

  @Prop({ required: false })
  city?: string;

  @Prop({ required: false })
  country?: string;

  @Prop({ required: false })
  region?: string;

  @Prop({ required: false })
  postal_code?: string;

  @Prop({ required: false })
  sex?: string;

  @Prop({ required: false })
  contactId!: string; // row ID from ICM

  @Prop({ default: Date.now })
  last_login!: Date;

  @Prop({ default: UserStatus.ACTIVE })
  status!: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
