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

describe('POST /application-package/additional-adult', () => {
  let harness: AuthorizationHarness;
  let world: AuthorizationWorld;
  let cookieA: string;
  const today = new Date().toLocaleDateString('en-CA');

  const valid = {
    relationshipToPrimary: 'Boarder',
    firstName: 'Sam',
    lastName: 'Lee',
    dateOfBirth: '1990-05-01',
    genderType: 'Man/Boy',
    email: 'sam@example.com',
    moveInDate: today,
  };

  const post = (body: object = valid, cookie = cookieA) =>
    request(harness.httpServer)
      .post('/application-package/additional-adult')
      .set('Cookie', cookie)
      .send(body);

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
    await harness.models.applicationPackage.deleteMany({
      subtype: 'Additional Adult',
    });
    await harness.models.householdMember.deleteMany({
      moveInDate: { $ne: null },
    });
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
  it('creates the package, member, screening forms and access code, and emails the member', async () => {
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
      subtype: 'Additional Adult',
      status: 'Consent',
      userId: world.userA.userId,
    });
    const members = await harness.models.householdMember
      .find({ applicationPackageId: body.applicationPackageId })
      .lean();
    expect(members.map((m) => m.relationshipToPrimary).sort()).toEqual([
      'Boarder',
      'Self',
    ]);
    const added = members.find(
      (m) => m.householdMemberId === body.householdMemberId,
    );
    expect(added).toMatchObject({
      firstName: 'Sam',
      moveInDate: today,
      requireScreening: true,
      memberType: 'Non-Caregiver Adult',
    });
    const forms = await harness.models.applicationForm
      .find({ householdMemberId: body.householdMemberId })
      .lean();
    expect(forms.length).toBeGreaterThan(0);

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
    expect(
      await harness.models.applicationPackage.countDocuments({
        subtype: 'Additional Adult',
      }),
    ).toBe(0);
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
    ['move-in before the case opened', { moveInDate: '1999-12-31' }],
    ['move-in more than 2 years out', { moveInDate: '2099-01-01' }],
    ['a caregiver relationship', { relationshipToPrimary: 'Spouse' }],
    ['an invalid gender', { genderType: 'Other' }],
    ['a bad email', { email: 'nope' }],
    ['a missing email', { email: undefined }],
    ['an extra field', { extra: 1 }],
  ])('400s for %s, and creates nothing', async (_n, override) => {
    expect((await post({ ...valid, ...override })).status).toBe(400);
    expect(
      await harness.models.applicationPackage.countDocuments({
        subtype: 'Additional Adult',
      }),
    ).toBe(0);
  });
  it('409s for the same person twice', async () => {
    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(409);
  });

  it('withdraws the package when the access code email cannot be queued', async () => {
    harness.queues.notification.add.mockRejectedValueOnce(new Error('down'));
    const res = await post();
    expect(res.status).toBe(500);
    const pkgs = await harness.models.applicationPackage
      .find({ subtype: 'Additional Adult' })
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
      .post('/application-package/additional-adult')
      .send(valid);
    expect([401, 403]).toContain(res.status);
  });

  it('GET lists the members whose screening is in progress, without the caregiver', async () => {
    const created = (await post()).body as { applicationPackageId: string };
    const res = await request(harness.httpServer)
      .get('/application-package/additional-adult')
      .set('Cookie', cookieA);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        applicationPackageId: created.applicationPackageId,
        firstName: 'Sam',
        lastName: 'Lee',
        relationshipToPrimary: 'Boarder',
        moveInDate: today,
        submitted: false,
      }),
    ]);
  });

  it('GET lists nothing once the package is cancelled', async () => {
    const created = (await post()).body as { applicationPackageId: string };
    await request(harness.httpServer)
      .delete(`/application-package/${created.applicationPackageId}`)
      .set('Cookie', cookieA);
    const res = await request(harness.httpServer)
      .get('/application-package/additional-adult')
      .set('Cookie', cookieA);
    expect(res.body).toEqual([]);
  });
  it('GET marks members of a submitted package as submitted', async () => {
    const created = (await post()).body as { applicationPackageId: string };
    await harness.models.applicationPackage.updateOne(
      { applicationPackageId: created.applicationPackageId },
      { $set: { submissionStatus: 'success' } },
    );
    const res = await request(harness.httpServer)
      .get('/application-package/additional-adult')
      .set('Cookie', cookieA);
    expect(res.body).toEqual([expect.objectContaining({ submitted: true })]);
  });
});
