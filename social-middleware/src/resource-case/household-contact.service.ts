import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { NOT_MANAGEABLE_RELATIONSHIPS } from '../siebel/enums/icm-case-contact-relationship.enum';
import {
  HouseholdContact,
  HouseholdContactDocument,
} from './schema/household-contact.schema';

// fields written by the login sync
export type IcmContactFields = Pick<
  HouseholdContact,
  | 'case_contact_id'
  | 'person_id'
  | 'linked_user_id'
  | 'first_name'
  | 'last_name'
  | 'relationship'
  | 'contact_end_date'
>;

const PUBLIC_FIELDS =
  'case_contact_id first_name last_name relationship contact_end_date removal_requested removal_departure_date';

@Injectable()
export class HouseholdContactService {
  constructor(
    @InjectModel(HouseholdContact.name)
    private readonly model: Model<HouseholdContactDocument>,
  ) {}

  // today is YYYY-MM-DD; a contact ending today or earlier is not listed
  // list the adults associated with this resource case
  listActiveForCase(caseId: string, today: string) {
    return this.model
      .find({
        case_id: caseId,
        relationship: { $nin: NOT_MANAGEABLE_RELATIONSHIPS },
        $or: [{ contact_end_date: null }, { contact_end_date: { $gt: today } }],
      })
      .select(PUBLIC_FIELDS)
      .sort({ createdAt: 1 })
      .lean()
      .exec();
  }

  findOneForCase(caseId: string, caseContactId: string) {
    return this.model
      .findOne({
        case_id: caseId,
        case_contact_id: caseContactId,
      })
      .lean()
      .exec();
  }

  /**
   * Upsert the synced fields. `removal_*` appears only in $setOnInsert, so a
   * sync can never overwrite it. $max keeps synced_at monotonic when two
   * syncs of the same case overlap (two instances, or both caregivers logging
   * in), so the stale sweep below can never delete a contact the other sync
   * just wrote.
   */
  async syncFromIcm(
    caseId: string,
    contacts: IcmContactFields[],
    syncedAt: Date,
  ): Promise<void> {
    if (contacts.length > 0) {
      await this.model.bulkWrite(
        contacts.map((c) => ({
          updateOne: {
            filter: { case_id: caseId, case_contact_id: c.case_contact_id },
            update: {
              $set: { ...c, case_id: caseId },
              $max: { synced_at: syncedAt },
              $setOnInsert: {
                removal_requested: false,
                removal_departure_date: null,
                removal_requested_at: null,
                removal_claim_id: null,
                removal_claimed_at: null,
              },
            },
            upsert: true,
          },
        })),
      );
    }
    // anything not touched by this sync: gone from ICM
    await this.model.deleteMany({
      case_id: caseId,
      synced_at: { $lt: syncedAt },
    });
  }

  async deleteAllForCase(caseId: string): Promise<void> {
    await this.model.deleteMany({ case_id: caseId });
  }

  async claimRemoval(
    caseId: string,
    caseContactId: string,
    claimId: string,
    staleBefore: Date,
  ): Promise<boolean> {
    const res = await this.model.updateOne(
      {
        case_id: caseId,
        case_contact_id: caseContactId,
        removal_requested: false,
        $or: [
          { removal_claimed_at: null },
          { removal_claimed_at: { $lt: staleBefore } },
        ],
      },
      { $set: { removal_claim_id: claimId, removal_claimed_at: new Date() } },
    );
    return res.modifiedCount === 1;
  }

  async completeRemoval(
    caseId: string,
    caseContactId: string,
    claimId: string,
    departureDate: string,
  ): Promise<boolean> {
    const res = await this.model.updateOne(
      {
        case_id: caseId,
        case_contact_id: caseContactId,
        removal_claim_id: claimId,
      },
      {
        $set: {
          removal_requested: true,
          removal_departure_date: departureDate,
          removal_requested_at: new Date(),
          removal_claim_id: null,
          removal_claimed_at: null,
        },
      },
    );
    return res.modifiedCount === 1;
  }

  async releaseRemoval(
    caseId: string,
    caseContactId: string,
    claimId: string,
  ): Promise<void> {
    await this.model.updateOne(
      {
        case_id: caseId,
        case_contact_id: caseContactId,
        removal_claim_id: claimId,
      },
      { $set: { removal_claim_id: null, removal_claimed_at: null } },
    );
  }
}
