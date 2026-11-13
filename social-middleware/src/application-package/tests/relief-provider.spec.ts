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
      subtype: 'Relief Provider',
      status: 'Consent',
      userId: world.userA.userId,
    });

    const members = await harness.models.householdMember
      .find({ applicationPackageId: body.applicationPackageId })
      .lean();
    expect(members.map((m) => m.relationshipToPrimary).sort()).toEqual([
      'Relief Caregiver',
      'Self',
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
});
