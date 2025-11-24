import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { MemberTypes } from '../enums/member-types.enum';
import { GenderTypes } from '../enums/gender-types.enum';
import { RelationshipToPrimary } from '../enums/relationship-to-primary.enum';

@Schema({ timestamps: true })
export class HouseholdMembers {
  @Prop({ required: true, type: String })
  applicationPackageId!: string;

  @Prop({ required: true, unique: true, type: String, default: uuidv4 })
  householdMemberId!: string;

  @Prop({ required: false, type: String, default: null })
  userId!: string;

  @Prop({ required: true, type: String })
  firstName!: string;

  @Prop({ required: true, type: String })
  lastName!: string;

  @Prop({ required: true, type: String })
  dateOfBirth!: string; // ISO date string

  @Prop({ required: false, type: String })
  email?: string;

  @Prop({
    required: true,
    enum: Object.values(MemberTypes),
    default: MemberTypes.Primary,
  })
  memberType!: MemberTypes;

  @Prop({
    required: true,
    enum: Object.values(GenderTypes),
    default: GenderTypes.Unspecified,
  })
  genderType!: GenderTypes;

  @Prop({
    required: true,
    enum: Object.values(RelationshipToPrimary),
    default: RelationshipToPrimary.Self,
  })
  relationshipToPrimary!: RelationshipToPrimary;

  @Prop({ type: Boolean, default: false })
  requireScreening!: boolean;

  @Prop({ type: Boolean, default: false })
  screeningProvided!: boolean;

  @Prop({ required: false, type: Boolean, default: false })
  isInvited!: boolean;

  @Prop({ required: false, type: Date, default: null })
  invitationLastSent!: Date;

  @Prop({ type: Number, default: 0 })
  numberOfInvitationsSent!: number;

  createdAt!: Date;
}

export type HouseholdMembersDocument = HouseholdMembers & Document;

export const HouseholdMembersSchema =
  SchemaFactory.createForClass(HouseholdMembers);
