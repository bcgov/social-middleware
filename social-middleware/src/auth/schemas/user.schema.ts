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

  @Prop({ required: true })
  last_name!: string;

  @Prop({ required: true })
  email!: string;

  @Prop({ required: false })
  home_phone?: string;

  @Prop({ required: false })
  alternate_phone?: string;

  @Prop({ required: true })
  dateOfBirth!: string;

  @Prop({ required: true })
  street_address!: string;

  @Prop({ required: true })
  city!: string;

  @Prop({ required: true })
  country!: string;

  @Prop({ required: true })
  region!: string;

  @Prop({ required: true })
  postal_code!: string;

  @Prop({ required: false })
  sex?: string;

  @Prop({ required: false })
  contact_id!: string; // row ID from ICM

  @Prop({ required: false, type: String, default: null })
  resource_case_id?: string;

  @Prop({ required: false, type: Date, default: null })
  resource_case_active_date?: Date;

  @Prop({ type: Boolean, default: false })
  resource_case_closed!: boolean;

  @Prop({ required: false, type: Date, default: null })
  resource_case_last_checked?: Date;

  @Prop({ default: Date.now })
  last_login!: Date;

  @Prop({ required: false })
  bcsc_last_synced?: Date;

  @Prop({ default: false })
  bcsc_update_pending!: boolean;

  @Prop({ default: UserStatus.ACTIVE })
  status!: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
