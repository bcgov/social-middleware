import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { v4 as uuidv4 } from 'uuid';
import { MemberTypes } from '../enums/member-types.enum';
import { RelationshipToPrimary } from '../enums/relationship-to-primary.enum';

export type HouseholdMembersDocument = HouseholdMembers & Document;

@Schema({ timestamps: true })
export class HouseholdMembers {
  @Prop({ required: true, type: String })
  applicationId!: string;

  @Prop({ required: true, unique: true, type: String, default: uuidv4 })
  householdMemberId!: string;

  @Prop({ required: true, type: String })
  userId!: string;

  @Prop({ required: true, type: String })
  firstName!: string;

  @Prop({ required: true, type: String })
  lastName!: string;

  @Prop({ required: true, type: String })
  dateOfBirth!: string; // ISO date string

  @Prop({ required: true, type: String })
  email!: string;

  @Prop({
    required: true,
    enum: Object.values(MemberTypes),
    default: MemberTypes.Primary,
  })
  memberType!: MemberTypes;

  @Prop({
    required: true,
    enum: Object.values(RelationshipToPrimary),
    default: RelationshipToPrimary.Self,
  })
  relationshipToPrimary!: RelationshipToPrimary;

  @Prop({ type: Boolean, default: false })
  requireScreening!: boolean;

  createdAt!: Date;
}

export const HouseholdMembersSchema =
  SchemaFactory.createForClass(HouseholdMembers);
