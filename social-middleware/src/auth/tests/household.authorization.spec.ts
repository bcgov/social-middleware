import * as request from 'supertest';
import {
  AuthorizationHarness,
  mintSessionCookie,
  startAuthorizationApp,
} from './helpers/authorization-harness';
import {
  AuthorizationWorld,
  seedTwoApplicants,
} from './helpers/authorization-seed';

describe('Household cross-applicant authorization', () => {
  let harness: AuthorizationHarness;
  let world: AuthorizationWorld;
  let cookieA: string;
  let cookieB: string;
  let cookieM: string;

  const membersUrl = (packageId: string) =>
    `/application-package/${packageId}/household-members`;
  const memberUrl = (packageId: string, memberId: string) =>
    `${membersUrl(packageId)}/${memberId}`;

  beforeAll(async () => {
    harness = await startAuthorizationApp();
    world = await seedTwoApplicants(harness.models);
    cookieA = mintSessionCookie({
      userId: world.userA.userId,
      sub: world.userA.bcServicesCardId,
      email: world.userA.email,
      name: 'Alice APPLICANT',
    }).cookie;
    cookieB = mintSessionCookie({
      userId: world.userB.userId,
      sub: world.userB.bcServicesCardId,
      email: world.userB.email,
      name: 'Bob BYSTANDER',
    }).cookie;
    cookieM = mintSessionCookie({
      userId: world.userM.userId,
      sub: world.userM.bcServicesCardId,
      email: world.userM.email,
      name: 'Mia MEMBER',
    }).cookie;
  });

  afterAll(async () => {
    await harness.stop();
  });

  describe('POST household members', () => {
    const mismatchMemberId = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
    const memberBody = (packageId: string) => ({
      applicationPackageId: packageId,
      firstName: 'New',
      lastName: 'MEMBER',
      dateOfBirth: '1990-04-01',
      relationshipToPrimary: 'Sibling',
      email: 'new.member@example.com',
    });

    it('allows the package owner to create a member on their own package', async () => {
      const res = await request(harness.httpServer)
        .post(membersUrl(world.packageA.applicationPackageId))
        .set('Cookie', cookieA)
        .send(memberBody(world.packageA.applicationPackageId));

      expect(res.status).toBe(201);
    });

    it('rejects a non-owner even with a valid body', async () => {
      const res = await request(harness.httpServer)
        .post(membersUrl(world.packageA.applicationPackageId))
        .set('Cookie', cookieB)
        .send(memberBody(world.packageA.applicationPackageId));

      expect([401, 403]).toContain(res.status);
    });

    it('rejects unauthenticated requests', async () => {
      const res = await request(harness.httpServer)
        .post(membersUrl(world.packageA.applicationPackageId))
        .send(memberBody(world.packageA.applicationPackageId));

      expect([401, 403]).toContain(res.status);
    });

    it('rejects a body applicationPackageId that targets another applicant (URL/body mismatch)', async () => {
      const res = await request(harness.httpServer)
        .post(membersUrl(world.packageA.applicationPackageId))
        .set('Cookie', cookieA)
        .send({
          ...memberBody(world.packageB.applicationPackageId),
          householdMemberId: mismatchMemberId,
        });

      expect([401, 403]).toContain(res.status);
      const created = await harness.models.householdMember
        .findOne({ householdMemberId: mismatchMemberId })
        .lean();
      expect(created).toBeNull();
    });
  });

  describe('GET household members', () => {
    it('returns only the owner package members, never the other applicant’s', async () => {
      const res = await request(harness.httpServer)
        .get(membersUrl(world.packageA.applicationPackageId))
        .set('Cookie', cookieA);

      expect([200, 201]).toContain(res.status);
      const members = res.body as Array<{
        householdMemberId: string;
        applicationPackageId: string;
      }>;
      const ids = members.map((m) => m.householdMemberId);
      expect(ids).toContain(world.memberA.linked.householdMemberId);
      expect(ids).not.toContain(world.memberB.self.householdMemberId);
    });

    it('rejects a non-owner of the package', async () => {
      const res = await request(harness.httpServer)
        .get(membersUrl(world.packageA.applicationPackageId))
        .set('Cookie', cookieB);

      expect([401, 403]).toContain(res.status);
    });

    it('rejects unauthenticated requests', async () => {
      const res = await request(harness.httpServer).get(
        membersUrl(world.packageA.applicationPackageId),
      );

      expect([401, 403]).toContain(res.status);
    });
  });

  describe('GET single household member', () => {
    it('allows the package owner', async () => {
      const res = await request(harness.httpServer)
        .get(
          memberUrl(
            world.packageA.applicationPackageId,
            world.memberA.linked.householdMemberId,
          ),
        )
        .set('Cookie', cookieA);

      expect([200, 201]).toContain(res.status);
    });

    it('rejects another applicant reading a member they do not own', async () => {
      const res = await request(harness.httpServer)
        .get(
          memberUrl(
            world.packageA.applicationPackageId,
            world.memberA.linked.householdMemberId,
          ),
        )
        .set('Cookie', cookieB);

      expect([401, 403]).toContain(res.status);
      const body = res.body as Record<string, unknown>;
      expect(body.email).toBeUndefined();
    });
  });

  describe('PATCH household member', () => {
    it('rejects another applicant modifying a member and leaves data unchanged', async () => {
      const res = await request(harness.httpServer)
        .patch(
          memberUrl(
            world.packageA.applicationPackageId,
            world.memberA.child.householdMemberId,
          ),
        )
        .set('Cookie', cookieB)
        .send({ lastName: 'HACKED', dateOfBirth: '1990-01-01' });

      expect([401, 403]).toContain(res.status);
      const member = await harness.models.householdMember
        .findOne({ householdMemberId: world.memberA.child.householdMemberId })
        .lean();
      expect((member as { lastName: string } | null)?.lastName).toBe('CHILD');
    });

    it('rejects unauthenticated requests', async () => {
      const res = await request(harness.httpServer)
        .patch(
          memberUrl(
            world.packageA.applicationPackageId,
            world.memberA.child.householdMemberId,
          ),
        )
        .send({ lastName: 'HACKED', dateOfBirth: '1990-01-01' });

      expect([401, 403]).toContain(res.status);
    });
  });

  describe('DELETE household member', () => {
    it('rejects another applicant deleting a member and leaves the record intact', async () => {
      const res = await request(harness.httpServer)
        .delete(
          memberUrl(
            world.packageA.applicationPackageId,
            world.memberA.child.householdMemberId,
          ),
        )
        .set('Cookie', cookieB);

      expect([401, 403]).toContain(res.status);
      const member = await harness.models.householdMember
        .findOne({ householdMemberId: world.memberA.child.householdMemberId })
        .lean();
      expect(member).not.toBeNull();
    });
  });

  describe('confirm-screening-package', () => {
    const confirmUrl = (memberId: string) =>
      `${memberUrl(world.packageA.applicationPackageId, memberId)}/confirm-screening-package`;

    it('allows the household member to confirm their own screening package', async () => {
      const res = await request(harness.httpServer)
        .post(confirmUrl(world.memberA.linked.householdMemberId))
        .set('Cookie', cookieM);

      expect([200, 201]).toContain(res.status);
      const body = res.body as { success: boolean };
      expect(body.success).toBe(true);
    });

    it('rejects the owner confirming on behalf of a member without their own login', async () => {
      const res = await request(harness.httpServer)
        .post(confirmUrl(world.memberA.spouse.householdMemberId))
        .set('Cookie', cookieA);

      expect([401, 403]).toContain(res.status);
    });

    it('rejects another applicant outright', async () => {
      const res = await request(harness.httpServer)
        .post(confirmUrl(world.memberA.linked.householdMemberId))
        .set('Cookie', cookieB);

      expect([401, 403]).toContain(res.status);
    });

    it('rejects unauthenticated requests', async () => {
      const res = await request(harness.httpServer).post(
        confirmUrl(world.memberA.linked.householdMemberId),
      );

      expect([401, 403]).toContain(res.status);
    });
  });

  describe('mark-screening-documents-attached', () => {
    const markUrl = (memberId: string) =>
      `${memberUrl(world.packageA.applicationPackageId, memberId)}/mark-screening-documents-attached`;
    const screeningState = async (memberId: string) => {
      const member = await harness.models.householdMember
        .findOne({ householdMemberId: memberId })
        .lean();
      return (member as { screeningInfoProvided: boolean } | null)
        ?.screeningInfoProvided;
    };

    it('allows the primary applicant to mark documents for a non-co-applicant member', async () => {
      const res = await request(harness.httpServer)
        .post(markUrl(world.memberA.child.householdMemberId))
        .set('Cookie', cookieA);

      expect([200, 201]).toContain(res.status);
      const body = res.body as { success: boolean; formsUpdated: number };
      expect(body.success).toBe(true);
      expect(body.formsUpdated).toBe(2);
      await expect(
        screeningState(world.memberA.child.householdMemberId),
      ).resolves.toBe(true);
    });

    it.each([
      ['spouse', () => world.memberA.spouse],
      ['partner', () => world.memberA.partner],
      ['common law', () => world.memberA.commonLaw],
    ])(
      'blocks the primary applicant from marking documents for a co-applicant (%s)',
      async (_label, getMember) => {
        const member = getMember();
        const res = await request(harness.httpServer)
          .post(markUrl(member.householdMemberId))
          .set('Cookie', cookieA);

        expect([401, 403]).toContain(res.status);
        await expect(screeningState(member.householdMemberId)).resolves.toBe(
          false,
        );
      },
    );

    it('blocks the household member marking their own documents (owner-only operation)', async () => {
      const stateBefore = await screeningState(
        world.memberA.linked.householdMemberId,
      );
      const res = await request(harness.httpServer)
        .post(markUrl(world.memberA.linked.householdMemberId))
        .set('Cookie', cookieM);

      expect([401, 403]).toContain(res.status);
      await expect(
        screeningState(world.memberA.linked.householdMemberId),
      ).resolves.toBe(stateBefore);
    });

    it('rejects another applicant with no state change and no external side effects', async () => {
      const queueCallsBefore =
        harness.queues.notification.add.mock.calls.length;
      const res = await request(harness.httpServer)
        .post(markUrl(world.memberA.child.householdMemberId))
        .set('Cookie', cookieB);

      expect([401, 403]).toContain(res.status);
      expect(harness.queues.notification.add.mock.calls.length).toBe(
        queueCallsBefore,
      );
    });

    it('rejects unauthenticated requests', async () => {
      const res = await request(harness.httpServer).post(
        markUrl(world.memberA.child.householdMemberId),
      );

      expect([401, 403]).toContain(res.status);
    });
  });

  describe('access-code resend', () => {
    const resendUrl = (memberId: string) =>
      `${memberUrl(world.packageA.applicationPackageId, memberId)}/access-code/resend`;

    it('rejects another applicant with no code generated and no email queued', async () => {
      const codesBefore = await harness.models.screeningAccessCode
        .countDocuments({
          householdMemberId: world.memberA.child.householdMemberId,
        })
        .exec();
      const queueCallsBefore =
        harness.queues.notification.add.mock.calls.length;

      const res = await request(harness.httpServer)
        .post(resendUrl(world.memberA.child.householdMemberId))
        .set('Cookie', cookieB);

      expect([401, 403]).toContain(res.status);
      await expect(
        harness.models.screeningAccessCode
          .countDocuments({
            householdMemberId: world.memberA.child.householdMemberId,
          })
          .exec(),
      ).resolves.toBe(codesBefore);
      expect(harness.queues.notification.add.mock.calls.length).toBe(
        queueCallsBefore,
      );
    });
    it('allows the owner to resend, which queues the notification', async () => {
      const queueCallsBefore =
        harness.queues.notification.add.mock.calls.length;

      const res = await request(harness.httpServer)
        .post(resendUrl(world.memberA.partner.householdMemberId))
        .set('Cookie', cookieA);

      expect([200, 201]).toContain(res.status);
      expect(harness.queues.notification.add.mock.calls.length).toBeGreaterThan(
        queueCallsBefore,
      );
    });
  });

  describe('GET household member access code', () => {
    const codeUrl = (memberId: string) =>
      `${memberUrl(world.packageA.applicationPackageId, memberId)}/access-code`;

    it('returns the code to the package owner', async () => {
      const res = await request(harness.httpServer)
        .get(codeUrl(world.memberA.linked.householdMemberId))
        .set('Cookie', cookieA);

      expect(res.status).toBe(200);
      const body = res.body as { accessCode: string };
      expect(body.accessCode).toBe(world.accessCodeA.code);
    });

    it('does not leak the code to another applicant', async () => {
      const res = await request(harness.httpServer)
        .get(codeUrl(world.memberA.linked.householdMemberId))
        .set('Cookie', cookieB);

      expect([401, 403]).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toContain(world.accessCodeA.code);
    });
  });

  describe('access-code associate', () => {
    it('does not associate another applicant’s code with the caller', async () => {
      const res = await request(harness.httpServer)
        .post('/household/access-code/associate')
        .set('Cookie', cookieA)
        .send({ accessCode: world.accessCodeB.code });

      const body = res.body as { success: boolean };
      expect(body.success).toBe(false);

      const codeRecord = await harness.models.screeningAccessCode
        .findOne({ accessCode: world.accessCodeB.code })
        .lean();
      expect(
        (codeRecord as { isUsed: boolean; assignedUserId?: string } | null)
          ?.isUsed,
      ).toBe(false);
      expect(
        (codeRecord as { assignedUserId?: string } | null)?.assignedUserId,
      ).toBeFalsy();
    });
  });

  describe('GET /household/members', () => {
    it('returns only the caller’s own members', async () => {
      const resA = await request(harness.httpServer)
        .get('/household/members')
        .set('Cookie', cookieA);

      expect(resA.status).toBe(200);
      const membersA = resA.body as Array<{ householdMemberId: string }>;
      const idsA = membersA.map((m) => m.householdMemberId);
      expect(idsA).not.toContain(world.memberB.self.householdMemberId);

      const resM = await request(harness.httpServer)
        .get('/household/members')
        .set('Cookie', cookieM);

      expect(resM.status).toBe(200);
      const membersM = resM.body as Array<{ householdMemberId: string }>;
      expect(membersM.map((m) => m.householdMemberId)).toEqual([
        world.memberA.linked.householdMemberId,
      ]);
    });
  });
});
