import { Test } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { HouseholdContactService } from '../household-contact.service';
import type { IcmContactFields } from '../household-contact.service';
import { IcmCaseContactRelationship as Rel } from '../../siebel/enums/icm-case-contact-relationship.enum';

import {
  HouseholdContact,
  HouseholdContactDocument,
  HouseholdContactSchema,
} from '../schema/household-contact.schema';

const C = 'case-1';
const K = 'cc-1';

const icm = (
  id: string,
  over: Partial<IcmContactFields> = {},
): IcmContactFields => ({
  case_contact_id: id,
  person_id: `p-${id}`,
  first_name: `First${id}`,
  last_name: `Last${id}`,
  relationship: Rel.Parent,
  contact_end_date: null,
  linked_user_id: null,
  ...over,
});

describe('HouseholdContactService', () => {
  let mongod: MongoMemoryServer;
  let svc: HouseholdContactService;
  let model: Model<HouseholdContactDocument>;
  let moduleRef: Awaited<ReturnType<typeof buildModule>>;

  async function buildModule(uri: string) {
    return Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(uri),
        MongooseModule.forFeature([
          { name: HouseholdContact.name, schema: HouseholdContactSchema },
        ]),
      ],
      providers: [HouseholdContactService],
    }).compile();
  }

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    moduleRef = await buildModule(mongod.getUri());
    svc = moduleRef.get(HouseholdContactService);
    model = moduleRef.get(getModelToken(HouseholdContact.name));
    await model.syncIndexes();
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  beforeEach(async () => {
    await model.deleteMany({});
  });

  const t1 = new Date('2026-10-01T00:00:00Z');
  const t2 = new Date('2026-10-02T00:00:00Z');
  const fresh = () => new Date(Date.now() - 120_000); // claims older than this are stale

  describe('claim / complete / release', () => {
    beforeEach(async () => {
      await svc.syncFromIcm(C, [icm(K)], t1);
    });

    it('only one of two concurrent claims wins', async () => {
      const [a, b] = await Promise.all([
        svc.claimRemoval(C, K, 'a', fresh()),
        svc.claimRemoval(C, K, 'b', fresh()),
      ]);
      expect([a, b].filter(Boolean)).toHaveLength(1);
    });

    it('does not take over a fresh claim, but takes over a stale one', async () => {
      expect(await svc.claimRemoval(C, K, 'a', fresh())).toBe(true);
      expect(await svc.claimRemoval(C, K, 'b', fresh())).toBe(false);

      // age the claim past the TTL
      await model.updateOne(
        { case_contact_id: K },
        { $set: { removal_claimed_at: new Date(Date.now() - 10 * 60_000) } },
      );
      expect(await svc.claimRemoval(C, K, 'b', fresh())).toBe(true);
      const doc = await svc.findOneForCase(C, K);
      expect(doc?.removal_claim_id).toBe('b');
    });

    it('complete sets the removal fields and clears the claim', async () => {
      await svc.claimRemoval(C, K, 'a', fresh());
      expect(await svc.completeRemoval(C, K, 'a', '2026-11-01')).toBe(true);

      const doc = await svc.findOneForCase(C, K);
      expect(doc).toMatchObject({
        removal_requested: true,
        removal_departure_date: '2026-11-01',
        removal_claim_id: null,
        removal_claimed_at: null,
      });
      expect(doc?.removal_requested_at).toBeInstanceOf(Date);
    });

    it('complete and release with the wrong claim id change nothing', async () => {
      await svc.claimRemoval(C, K, 'a', fresh());

      expect(await svc.completeRemoval(C, K, 'other', '2026-11-01')).toBe(
        false,
      );
      await svc.releaseRemoval(C, K, 'other');

      const doc = await svc.findOneForCase(C, K);
      expect(doc?.removal_requested).toBe(false);
      expect(doc?.removal_claim_id).toBe('a');
    });

    it('release with the right claim id frees the contact for a new claim', async () => {
      await svc.claimRemoval(C, K, 'a', fresh());
      await svc.releaseRemoval(C, K, 'a');

      const doc = await svc.findOneForCase(C, K);
      expect(doc?.removal_claim_id).toBeNull();
      expect(await svc.claimRemoval(C, K, 'b', fresh())).toBe(true);
    });

    it('claim fails once removal_requested is true', async () => {
      await svc.claimRemoval(C, K, 'a', fresh());
      await svc.completeRemoval(C, K, 'a', '2026-11-01');
      expect(await svc.claimRemoval(C, K, 'b', fresh())).toBe(false);
    });

    it('claim fails for another case', async () => {
      expect(await svc.claimRemoval('case-2', K, 'x', fresh())).toBe(false);
    });
  });

  describe('syncFromIcm', () => {
    it('inserts new contacts with removal defaults', async () => {
      await svc.syncFromIcm(C, [icm('a')], t1);

      const doc = await svc.findOneForCase(C, 'a');
      expect(doc).toMatchObject({
        case_id: C,
        first_name: 'Firsta',
        linked_user_id: null,
        removal_requested: false,
        removal_departure_date: null,
        removal_requested_at: null,
        removal_claim_id: null,
        removal_claimed_at: null,
      });
    });

    it('removal_* survive a re-sync, while synced fields are refreshed', async () => {
      await svc.syncFromIcm(C, [icm(K)], t1);
      await svc.claimRemoval(C, K, 'a', fresh());
      await svc.completeRemoval(C, K, 'a', '2026-11-01');

      await svc.syncFromIcm(C, [icm(K, { first_name: 'Renamed' })], t2);

      const doc = await svc.findOneForCase(C, K);
      expect(doc).toMatchObject({
        first_name: 'Renamed',
        removal_requested: true,
        removal_departure_date: '2026-11-01',
      });
    });

    it('a re-sync does not wipe an in-flight claim', async () => {
      await svc.syncFromIcm(C, [icm(K)], t1);
      await svc.claimRemoval(C, K, 'a', fresh());

      await svc.syncFromIcm(C, [icm(K)], t2);

      const doc = await svc.findOneForCase(C, K);
      expect(doc?.removal_claim_id).toBe('a');
    });

    it('updates linked_user_id when a caregiver registers later', async () => {
      await svc.syncFromIcm(
        C,
        [icm('sp', { relationship: Rel.Spouse, linked_user_id: null })],
        t1,
      );
      await svc.syncFromIcm(
        C,
        [icm('sp', { relationship: Rel.Spouse, linked_user_id: 'user-9' })],
        t2,
      );
      expect((await svc.findOneForCase(C, 'sp'))?.linked_user_id).toBe(
        'user-9',
      );
    });

    it('deletes contacts that are missing from ICM', async () => {
      await svc.syncFromIcm(C, [icm('a'), icm('b')], t1);
      await svc.syncFromIcm(C, [icm('a')], t2);

      expect(await svc.findOneForCase(C, 'a')).not.toBeNull();
      expect(await svc.findOneForCase(C, 'b')).toBeNull();
    });

    it('an empty ICM list deletes everything for the case', async () => {
      await svc.syncFromIcm(C, [icm('a')], t1);
      await svc.syncFromIcm(C, [], t2);
      expect(await model.countDocuments({ case_id: C })).toBe(0);
    });

    it('does not touch other cases', async () => {
      await svc.syncFromIcm('case-9', [icm('z')], t1);
      await svc.syncFromIcm(C, [icm('a')], t2);
      expect(await svc.findOneForCase('case-9', 'z')).not.toBeNull();
    });

    it('a concurrent older sync cannot cause a newer contact to be swept', async () => {
      // newer sync (t2) wrote a and b; an older sync (t1) that only saw a finishes late
      await svc.syncFromIcm(C, [icm('a'), icm('b')], t2);
      await svc.syncFromIcm(C, [icm('a')], t1);

      expect(await svc.findOneForCase(C, 'b')).not.toBeNull();
      const a = await model.findOne({ case_contact_id: 'a' }).lean();
      expect(a?.synced_at.getTime()).toBe(t2.getTime()); // $max kept the newer stamp
    });

    it('two syncs of the same case (both caregivers) leave one row per contact', async () => {
      await Promise.all([
        svc.syncFromIcm(C, [icm('a'), icm('b')], t1),
        svc.syncFromIcm(C, [icm('a'), icm('b')], t1),
      ]);
      expect(await model.countDocuments({ case_id: C })).toBe(2);
    });
  });

  describe('deleteAllForCase', () => {
    it('removes only that case', async () => {
      await svc.syncFromIcm(C, [icm('a')], t1);
      await svc.syncFromIcm('case-2', [icm('z')], t1);

      await svc.deleteAllForCase(C);

      expect(await model.countDocuments({ case_id: C })).toBe(0);
      expect(await model.countDocuments({ case_id: 'case-2' })).toBe(1);
    });
  });

  describe('listActiveForCase', () => {
    it('excludes ended contacts, caregivers, relief caregivers and other cases', async () => {
      await svc.syncFromIcm(
        C,
        [
          icm('open'),
          icm('future', { contact_end_date: '2026-12-31' }),
          icm('today', { contact_end_date: '2026-10-26' }),
          icm('past', { contact_end_date: '2026-01-01' }),
          icm('relief', { relationship: Rel.Relief }),
          icm('kp', { relationship: Rel.KeyPlayer }),
          icm('spouse', { relationship: Rel.Spouse }),
          icm('partner', { relationship: Rel.Partner }),
          icm('cl', { relationship: Rel.CommonLaw }),
        ],
        t1,
      );
      await svc.syncFromIcm('case-2', [icm('other-case')], t1);

      const list = await svc.listActiveForCase(C, '2026-10-26');

      expect(list.map((c) => c.case_contact_id).sort()).toEqual([
        'future',
        'open',
      ]);
    });

    it('returns removal status but never claim fields or user links', async () => {
      await svc.syncFromIcm(C, [icm(K)], t1);
      await svc.claimRemoval(C, K, 'secret-claim', fresh());
      await svc.completeRemoval(C, K, 'secret-claim', '2026-11-01');

      const [row] = await svc.listActiveForCase(C, '2026-10-26');

      expect(row).toMatchObject({
        removal_requested: true,
        removal_departure_date: '2026-11-01',
      });
      expect(row).not.toHaveProperty('removal_claim_id');
      expect(row).not.toHaveProperty('removal_claimed_at');
      expect(row).not.toHaveProperty('linked_user_id');
      expect(row).not.toHaveProperty('person_id');
    });
  });
});
