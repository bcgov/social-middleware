import * as request from 'supertest';
import {
  AuthorizationHarness,
  mintSessionCookie,
  startAuthorizationApp,
} from '../../auth/tests/helpers/authorization-harness';
import {
  AuthorizationWorld,
  seedTwoApplicants,
} from '../../auth/tests/helpers/authorization-seed';
import { ApplicationFormStatus } from 'src/application-form/enums/application-form-status.enum';
import { RelationshipToPrimary } from 'src/household/enums/relationship-to-primary.enum';
import { ApplicationPackageSubType } from '../enums/application-package-subtypes.enum';

describe('POST /application-package/relief-provider', () => {
  let harness: AuthorizationHarness;
  let world: AuthorizationWorld;
  let cookieA: string;

  const valid = {
    firstName: 'Robin',
    lastName: 'Relief',
    dateOfBirth: '1990-05-01',
    genderType: 'Man/Boy',
    email: 'robin@example.com',
  };

  const post = (body: object = valid, cookie = cookieA) =>
    request(harness.httpServer)
      .post('/application-package/relief-provider')
      .set('Cookie', cookie)
      .send(body);

  const countReliefPackages = () =>
    harness.models.applicationPackage.countDocuments({
      subtype: 'Relief Provider',
    });
  beforeAll(async () => {
    harness = await startAuthorizationApp();
    process.env.TEST_RESOURCE_CASE = 'true'; // after startAuthorizationApp, which resets it
    world = await seedTwoApplicants(harness.models);
    cookieA = mintSessionCookie({
      userId: world.userA.userId,
      sub: world.userA.bcServicesCardId,
      email: world.userA.email,
      name: `${world.userA.firstName} ${world.userA.lastName}`,
    }).cookie;
    await harness.models.user.updateOne(
      { _id: world.userA.userId },
      {
        $set: {
          contact_id: 'icm-a',
          resource_case_id: 'case-a',
          resource_case_closed: false,
          resource_case_active_date: new Date('2000-01-01T00:00:00'),
        },
      },
    );
  });

  afterAll(async () => {
    delete process.env.TEST_RESOURCE_CASE;
    await harness.stop();
  });

  beforeEach(async () => {
    const ids = (
      await harness.models.applicationPackage
        .find({ subtype: 'Relief Provider' })
        .lean()
    ).map((p) => p.applicationPackageId);
    const byPackage = { applicationPackageId: { $in: ids } };
    await harness.models.applicationPackage.deleteMany(byPackage);
    await harness.models.householdMember.deleteMany(byPackage);
    await harness.models.applicationForm.deleteMany(byPackage);
    await harness.models.screeningAccessCode.deleteMany(byPackage);
    harness.queues.notification.add.mockClear();
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

  it('creates the package, the provider, their screening forms and access code, and emails them', async () => {
    const res = await post();
    expect(res.status).toBe(201);
    const body = res.body as {
      applicationPackageId: string;
      householdMemberId: string;
    };

    const pkg = await harness.models.applicationPackage
      .findOne({ applicationPackageId: body.applicationPackageId })
      .lean();
    expect(pkg).toMatchObject({
      subtype: ApplicationPackageSubType.RELIEF_PROVIDER,
      status: 'Consent',
      userId: world.userA.userId,
    });

    const members = await harness.models.householdMember
      .find({ applicationPackageId: body.applicationPackageId })
      .lean();
    expect(members.map((m) => m.relationshipToPrimary).sort()).toEqual([
      RelationshipToPrimary.ReliefProvider,
      RelationshipToPrimary.Self,
    ]);
    const provider = members.find(
      (m) => m.householdMemberId === body.householdMemberId,
    );
    expect(provider).toMatchObject({
      firstName: 'Robin',
      lastName: 'Relief',
      requireScreening: true,
      memberType: 'Non-Caregiver Adult',
    });
    expect(provider?.moveInDate ?? null).toBeNull();

    const forms = await harness.models.applicationForm
      .find({ householdMemberId: body.householdMemberId })
      .lean();
    expect(forms.map((f) => f.type).sort()).toEqual(
      [
        'About Me',
        'Consent for Disclosure of Criminal Record Information',
        'Consent for Prior Contact Check',
      ].sort(),
    );

    const codes = await harness.models.screeningAccessCode
      .find({ householdMemberId: body.householdMemberId })
      .lean();
    expect(codes).toHaveLength(1);
    expect(harness.queues.notification.add).toHaveBeenCalled();
  });

  it('sends the relief-specific email, not the household-member one', async () => {
    await post();
    const sent = JSON.stringify(harness.queues.notification.add.mock.calls);
    expect(sent).toContain('Respite/Relief Provider Screening Request');
    expect(sent).not.toContain('household member');
  });
  it('404s when TEST_RESOURCE_CASE is off', async () => {
    process.env.TEST_RESOURCE_CASE = 'false';
    const res = await post();
    process.env.TEST_RESOURCE_CASE = 'true';
    expect(res.status).toBe(404);
  });

  it('403s when the case is not open in ICM, and creates nothing', async () => {
    harness.siebel.getOpenResourceCasesByContactId.mockResolvedValue([]);
    expect((await post()).status).toBe(403);
    expect(await countReliefPackages()).toBe(0);
  });
  it.each([
    [
      'under 18',
      {
        dateOfBirth: new Date(Date.now() - 17 * 365 * 24 * 3600e3)
          .toISOString()
          .slice(0, 10),
      },
    ],
    ['not a real date', { dateOfBirth: '2000-02-31' }],
    ['an invalid gender', { genderType: 'Other' }],
    ['a bad email', { email: 'nope' }],
    ['a missing email', { email: undefined }],
    ['a relationship choice', { relationshipToPrimary: 'Boarder' }],
    ['a move-in date', { moveInDate: '2026-01-01' }],
    ['an extra field', { extra: 1 }],
  ])('400s for %s, and creates nothing', async (_n, override) => {
    expect((await post({ ...valid, ...override })).status).toBe(400);
    expect(await countReliefPackages()).toBe(0);
  });

  it('409s when the caregiver names themselves, and creates nothing', async () => {
    // real users have their date of birth stored as MM/DD/YYYY
    await harness.models.user.updateOne(
      { _id: world.userA.userId },
      { $set: { dateOfBirth: '01/15/1980' } },
    );
    try {
      const res = await post({
        ...valid,
        firstName: 'Alice',
        lastName: 'applicant',
        dateOfBirth: '1980-01-15',
      });
      expect(res.status).toBe(409);
      expect(await countReliefPackages()).toBe(0);

      // same name but a different date of birth is a different person
      const other = await post({
        ...valid,
        firstName: 'Alice',
        lastName: 'applicant',
        dateOfBirth: '1991-01-15',
      });
      expect(other.status).toBe(201);
    } finally {
      await harness.models.user.updateOne(
        { _id: world.userA.userId },
        { $set: { dateOfBirth: '1980-01-15' } },
      );
    }
  });
  it('409s for the same person twice', async () => {
    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(409);
  });

  it('allows a different provider alongside the first', async () => {
    expect((await post()).status).toBe(201);
    const second = await post({
      ...valid,
      firstName: 'Taylor',
      lastName: 'Other',
      email: 'taylor@example.com',
    });
    expect(second.status).toBe(201);
    expect(await countReliefPackages()).toBe(2);
  });
  it('allows inviting the same person again after the first invitation is cancelled', async () => {
    const first = (await post()).body as { applicationPackageId: string };
    const del = await request(harness.httpServer)
      .delete(`/application-package/${first.applicationPackageId}`)
      .set('Cookie', cookieA);
    expect(del.status).toBe(204);
    expect((await post()).status).toBe(201);
  });
  it('withdraws the package when the access code email cannot be queued', async () => {
    harness.queues.notification.add.mockRejectedValueOnce(new Error('down'));
    const res = await post();
    expect(res.status).toBe(500);
    const pkgs = await harness.models.applicationPackage
      .find({ subtype: 'Relief Provider' })
      .lean();
    expect(pkgs.map((p) => p.status)).toEqual(['Withdrawn']);
  });
  it('DELETE cancels the package outright, with its member, forms and access code', async () => {
    const created = (await post()).body as {
      applicationPackageId: string;
      householdMemberId: string;
    };
    const res = await request(harness.httpServer)
      .delete(`/application-package/${created.applicationPackageId}`)
      .set('Cookie', cookieA);
    expect(res.status).toBe(204);
    const byPackage = { applicationPackageId: created.applicationPackageId };
    expect(
      await harness.models.applicationPackage.countDocuments(byPackage),
    ).toBe(0);
    expect(await harness.models.householdMember.countDocuments(byPackage)).toBe(
      0,
    );
    expect(await harness.models.applicationForm.countDocuments(byPackage)).toBe(
      0,
    );
    expect(
      await harness.models.screeningAccessCode.countDocuments({
        householdMemberId: created.householdMemberId,
      }),
    ).toBe(0);
  });
  it('rejects unauthenticated requests', async () => {
    const res = await request(harness.httpServer)
      .post('/application-package/relief-provider')
      .send(valid);
    expect([401, 403]).toContain(res.status);
  });

  describe('POST …/household-members/:householdMemberId/mark-screening-documents-attached', () => {
    it('does not let the caregiver complete the screening on the provider’s behalf', async () => {
      const created = (await post()).body as {
        applicationPackageId: string;
        householdMemberId: string;
      };

      const res = await request(harness.httpServer)
        .post(
          `/application-package/${created.applicationPackageId}/household-members/${created.householdMemberId}/mark-screening-documents-attached`,
        )
        .set('Cookie', cookieA);

      expect([401, 403]).toContain(res.status);

      const member = await harness.models.householdMember
        .findOne({ householdMemberId: created.householdMemberId })
        .lean();
      expect(member?.screeningInfoProvided).toBe(false);

      const forms = await harness.models.applicationForm
        .find({ householdMemberId: created.householdMemberId })
        .lean();
      expect(forms.length).toBeGreaterThan(0);
      expect(
        forms.every((f) => f.status !== ApplicationFormStatus.COMPLETE),
      ).toBe(true);
    });
  });

  describe('who can be invited', () => {
    const seedContact = (over: Record<string, unknown> = {}) =>
      harness.models.householdContact.create({
        case_id: 'case-a',
        case_contact_id: `cc-${Math.random()}`,
        person_id: 'p-1',
        first_name: 'Robin',
        last_name: 'Relief',
        relationship: 'Parent',
        contact_end_date: null,
        linked_user_id: null,
        synced_at: new Date(),
        ...over,
      });
    beforeEach(async () => {
      await harness.models.householdContact.deleteMany({});
    });

    it('409s for someone on the case’s household, and creates nothing', async () => {
      await seedContact();
      expect((await post()).status).toBe(409);
      expect(await countReliefPackages()).toBe(0);
    });

    it('matches the household by full name, so a shared surname is fine', async () => {
      await seedContact({ first_name: 'Rhonda' });
      expect((await post()).status).toBe(201);
    });

    it('ignores household members who have left the case', async () => {
      await seedContact({ contact_end_date: '2000-01-01' });
      expect((await post()).status).toBe(201);
    });
    it('does not treat an existing relief provider on the case as household', async () => {
      await seedContact({ relationship: 'Relief Caregiver' });
      expect((await post()).status).toBe(201);
    });
    it('409s for a member of the caregiver’s own packages', async () => {
      const pkg = await harness.models.applicationPackage.findOne({
        userId: world.userA.userId,
      });
      expect(pkg).toBeTruthy();
      await harness.models.householdMember.create({
        applicationPackageId: pkg!.applicationPackageId,
        householdMemberId: 'hm-existing',
        firstName: 'Robin',
        lastName: 'Relief',
        dateOfBirth: '1990-05-01',
        relationshipToPrimary: 'Other',
      });
      try {
        expect((await post()).status).toBe(409);
      } finally {
        await harness.models.householdMember.deleteOne({
          householdMemberId: 'hm-existing',
        });
      }
    });
    it('allows inviting a provider again once their screening has been submitted', async () => {
      const first = (await post()).body as { applicationPackageId: string };
      await harness.models.applicationPackage.updateOne(
        { applicationPackageId: first.applicationPackageId },
        { $set: { status: 'Submitted', submissionStatus: 'success' } },
      );
      expect((await post()).status).toBe(201);
      expect(await countReliefPackages()).toBe(2);
    });
  });
});
