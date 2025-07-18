// auth/schemas/user.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true })
  bc_services_card_id!: string;

  @Prop({ required: true })
  first_name!: string;

  @Prop({ required: true })
  last_name!: string;

  @Prop({ required: true })
  email!: string;

  @Prop({ default: Date.now })
  last_login!: Date;

  @Prop({ default: 'active' })
  status!: string;
}

export const UserSchema = SchemaFactory.createForClass(User);