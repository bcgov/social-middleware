import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { IcmCaseContactRelationship } from '../../siebel/enums/icm-case-contact-relationship.enum';

// One row per contact on a resource case. The household belongs to the case,
// not to a user: both caregivers on a case share these rows (and the removal state).
@Schema({ timestamps: true, collection: 'household_contacts' })
export class HouseholdContact {
  @Prop({ required: true, type: String })
  case_id!: string;

  @Prop({ required: true, type: String })
  case_contact_id!: string;

  // derived on sync: the registered user this caregiver row belongs to, if any
  @Prop({ type: String, default: null })
  linked_user_id!: string | null;

  @Prop({ required: true, type: String })
  person_id!: string;

  @Prop({ type: String, default: '' })
  first_name!: string;

  @Prop({ type: String, default: '' })
  last_name!: string;

  @Prop({
    required: true,
    type: String,
    enum: Object.values(IcmCaseContactRelationship),
  })
  relationship!: IcmCaseContactRelationship;

  @Prop({ type: String, default: null })
  contact_end_date!: string | null; // YYYY-MM-DD

  // portal-owned state: never written by the ICM sync
  @Prop({ type: Boolean, default: false })
  removal_requested!: boolean;

  @Prop({ type: String, default: null })
  removal_departure_date!: string | null; // YYYY-MM-DD

  @Prop({ type: Date, default: null })
  removal_requested_at!: Date | null;

  @Prop({ type: String, default: null })
  removal_claim_id!: string | null;

  @Prop({ type: Date, default: null })
  removal_claimed_at!: Date | null;

  @Prop({ required: true, type: Date })
  synced_at!: Date;
}

export type HouseholdContactDocument = HydratedDocument<HouseholdContact>;
export const HouseholdContactSchema =
  SchemaFactory.createForClass(HouseholdContact);
HouseholdContactSchema.index(
  { case_id: 1, case_contact_id: 1 },
  { unique: true },
);
