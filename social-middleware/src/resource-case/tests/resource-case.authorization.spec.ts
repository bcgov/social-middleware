import * as request from 'supertest';
import {
  AuthorizationHarness,
  mintSessionCookie,
  mintTamperedSessionCookie,
  startAuthorizationApp,
} from '../../auth/tests/helpers/authorization-harness';
import {
  AuthorizationWorld,
  seedTwoApplicants,
} from '../../auth/tests/helpers/authorization-seed';

describe('Resource case cross-applicant authorization', () => {
  let harness: AuthorizationHarness;
  let world: AuthorizationWorld;
  let cookieA: string;
  const today = new Date().toLocaleDateString('en-CA');

  const cookieFor = (u: AuthorizationWorld['userA']) =>
    mintSessionCookie({
      userId: u.userId,
      sub: u.bcServicesCardId,
      email: u.email,
      name: `${u.firstName} ${u.lastName}`,
    }).cookie;

  const seedContact = (
    caseId: string,
    id: string,
    over: Record<string, unknown> = {},
  ) =>
    harness.models.householdContact.create({
      case_id: caseId,
      case_contact_id: id,
      person_id: `p-${id}`,
      first_name: 'Sam',
      last_name: 'Lee',
      relationship: 'Parent',
      contact_end_date: null,
      linked_user_id: null,
      synced_at: new Date(),
      ...over,
    });

  beforeAll(async () => {
    harness = await startAuthorizationApp();
    process.env.TEST_RESOURCE_CASE = 'true'; // after startAuthorizationApp, which resets it
    world = await seedTwoApplicants(harness.models);
    cookieA = cookieFor(world.userA);
    for (const [u, c] of [
      [world.userA, 'a'],
      [world.userB, 'b'],
    ] as const) {
      await harness.models.user.updateOne(
        { _id: u.userId },
        {
          $set: {
            contact_id: `icm-${c}`,
            resource_case_id: `case-${c}`,
            resource_case_closed: false,
            resource_case_active_date: new Date('2000-01-01T00:00:00'),
          },
        },
      );
    }
  });

  afterAll(async () => {
    delete process.env.TEST_RESOURCE_CASE;
    await harness.stop();
  });

  beforeEach(async () => {
    await harness.models.householdContact.deleteMany({});
    await seedContact('case-a', 'cc-a1');
    await seedContact('case-b', 'cc-b1');
    await seedContact('case-a', 'cc-kp', {
      relationship: 'Key player',
      linked_user_id: world.userA.userId,
    });
    harness.siebel.createHouseholdRemovalNotification
      .mockReset()
      .mockResolvedValue({});
    harness.siebel.getOpenResourceCasesByContactId
      .mockReset()
      .mockResolvedValue([
        {
          Id: 'case-a',
          'Case Num': 'RC-A',
          'Assigned To Id': 'sw-1',
          'Assigned To': 'SWORKER',
        },
      ]);
  });

  describe('GET /resource-case/household-contacts', () => {
    it('returns only the caller\u2019s case contacts, without claim internals', async () => {
      const res = await request(harness.httpServer)
        .get('/resource-case/household-contacts')
        .set('Cookie', cookieA);
      expect(res.status).toBe(200);
      const body = res.body as Array<Record<string, unknown>>;
      expect(body.map((c) => c.case_contact_id)).toEqual(['cc-a1']);
      expect(JSON.stringify(res.body)).not.toContain('cc-b1');
      expect(body[0]).not.toHaveProperty('removal_claim_id');
      expect(body[0]).not.toHaveProperty('removal_claimed_at');
    });

    it('does not list caregivers or expose user links', async () => {
      const res = await request(harness.httpServer)
        .get('/resource-case/household-contacts')
        .set('Cookie', cookieA);
      const body = res.body as Array<Record<string, unknown>>;
      expect(body.map((c) => c.case_contact_id)).not.toContain('cc-kp');
      expect(JSON.stringify(res.body)).not.toContain('linked_user_id');
    });

    it('returns [] when TEST_RESOURCE_CASE is off', async () => {
      process.env.TEST_RESOURCE_CASE = 'false';
      const res = await request(harness.httpServer)
        .get('/resource-case/household-contacts')
        .set('Cookie', cookieA);
      process.env.TEST_RESOURCE_CASE = 'true';
      expect(res.body).toEqual([]);
    });

    it('rejects unauthenticated and tampered sessions', async () => {
      const none = await request(harness.httpServer).get(
        '/resource-case/household-contacts',
      );
      expect([401, 403]).toContain(none.status);
      const tampered = await request(harness.httpServer)
        .get('/resource-case/household-contacts')
        .set(
          'Cookie',
          mintTamperedSessionCookie({
            userId: world.userA.userId,
            sub: world.userA.bcServicesCardId,
            email: world.userA.email,
            name: 'x',
          }),
        );
      expect([401, 403]).toContain(tampered.status);
    });
  });

  describe('POST /resource-case/household-contacts/:id/removal', () => {
    const post = (
      id: string,
      body: object = { departure_date: today },
      cookie = cookieA,
    ) =>
      request(harness.httpServer)
        .post(`/resource-case/household-contacts/${id}/removal`)
        .set('Cookie', cookie)
        .send(body);

    it('404s on another case\u2019s contact and leaves it untouched', async () => {
      const res = await post('cc-b1');
      expect(res.status).toBe(404);
      expect(
        harness.siebel.createHouseholdRemovalNotification,
      ).not.toHaveBeenCalled();
      const b = await harness.models.householdContact
        .findOne({ case_contact_id: 'cc-b1' })
        .lean();
      expect(b?.removal_requested).toBe(false);
      expect(b?.removal_claim_id).toBeNull();
    });

    it('403s and notifies nobody when TEST_RESOURCE_CASE is off', async () => {
      process.env.TEST_RESOURCE_CASE = 'false';
      const res = await post('cc-a1');
      process.env.TEST_RESOURCE_CASE = 'true';

      expect(res.status).toBe(403);
      expect(
        harness.siebel.createHouseholdRemovalNotification,
      ).not.toHaveBeenCalled();
    });

    it('403s when asked to remove a caregiver, and notifies nobody', async () => {
      const res = await post('cc-kp');
      expect(res.status).toBe(403);
      expect(
        harness.siebel.createHouseholdRemovalNotification,
      ).not.toHaveBeenCalled();
    });

    it('204s on the caller\u2019s own contact, notifies once, and persists', async () => {
      const res = await post('cc-a1');
      expect(res.status).toBe(204);
      expect(
        harness.siebel.createHouseholdRemovalNotification,
      ).toHaveBeenCalledWith(
        'case-a',
        expect.objectContaining({
          memberName: 'Sam Lee',
          departureDate: today,
          owner: 'sw-1',
        }),
      );
      const a = await harness.models.householdContact
        .findOne({ case_contact_id: 'cc-a1' })
        .lean();
      expect(a).toMatchObject({
        removal_requested: true,
        removal_departure_date: today,
        removal_claim_id: null,
      });
    });

    it('is idempotent: same date again is 204 with no second notification; a different date is 409', async () => {
      expect((await post('cc-a1')).status).toBe(204);
      expect((await post('cc-a1')).status).toBe(204);
      expect(
        harness.siebel.createHouseholdRemovalNotification,
      ).toHaveBeenCalledTimes(1);
      expect(
        (await post('cc-a1', { departure_date: '2000-06-01' })).status,
      ).toBe(409);
    });

    it('two simultaneous requests produce exactly one notification', async () => {
      const [r1, r2] = await Promise.all([post('cc-a1'), post('cc-a1')]);
      expect([r1.status, r2.status].sort()).toEqual(
        expect.arrayContaining([204]),
      );
      expect(
        harness.siebel.createHouseholdRemovalNotification,
      ).toHaveBeenCalledTimes(1);
    });
    it('releases the claim when ICM fails, so a retry works', async () => {
      harness.siebel.createHouseholdRemovalNotification.mockRejectedValueOnce(
        new Error('down'),
      );
      expect((await post('cc-a1')).status).toBe(502);
      expect((await post('cc-a1')).status).toBe(204);
    });

    it('400s on a bad or missing date and on extra fields', async () => {
      expect((await post('cc-a1', {})).status).toBe(400);
      expect(
        (await post('cc-a1', { departure_date: '23/10/2026' })).status,
      ).toBe(400);
      expect(
        (await post('cc-a1', { departure_date: '1999-01-01' })).status,
      ).toBe(400); // before the case opened
      expect(
        (await post('cc-a1', { departure_date: today, extra: 1 })).status,
      ).toBe(400);
    });

    it('rejects unauthenticated requests', async () => {
      const res = await request(harness.httpServer)
        .post('/resource-case/household-contacts/cc-a1/removal')
        .send({ departure_date: today });
      expect([401, 403]).toContain(res.status);
    });

    describe('two caregivers on one case', () => {
      const cookieB = () => cookieFor(world.userB);

      beforeEach(async () => {
        await harness.models.user.updateOne(
          { _id: world.userB.userId },
          { $set: { resource_case_id: 'case-a' } },
        );
      });

      afterEach(async () => {
        await harness.models.user.updateOne(
          { _id: world.userB.userId },
          { $set: { resource_case_id: 'case-b' } },
        );
      });

      it('share the list and the removal state: the second request is a no-op', async () => {
        expect((await post('cc-a1')).status).toBe(204);

        const list = await request(harness.httpServer)
          .get('/resource-case/household-contacts')
          .set('Cookie', cookieB());
        expect(list.body).toEqual([
          expect.objectContaining({
            case_contact_id: 'cc-a1',
            removal_requested: true,
            removal_departure_date: today,
          }),
        ]);

        const again = await post('cc-a1', { departure_date: today }, cookieB());
        expect(again.status).toBe(204);
        expect(
          harness.siebel.createHouseholdRemovalNotification,
        ).toHaveBeenCalledTimes(1);
      });
    });
  });
});
