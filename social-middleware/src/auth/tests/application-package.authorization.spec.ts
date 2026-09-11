import {
  ApplicationPackageSubSubType,
  ApplicationPackageSubType,
} from 'src/application-package/enums/application-package-subtypes.enum';
import { AttachmentType } from 'src/attachments/enums/attachment-types.enum';
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

describe('Application package cross-applicant authorization', () => {
  let harness: AuthorizationHarness;
  let world: AuthorizationWorld;
  let cookieA: string;
  let cookieB: string;

  const pkgUrl = (packageId: string, suffix = '') =>
    `/application-package/${packageId}${suffix}`;

  const packageDoc = async (packageId: string) =>
    await harness.models.applicationPackage
      .findOne({ applicationPackageId: packageId })
      .lean();

  const totalSiebelCalls = () =>
    (Object.values(harness.siebel) as jest.Mock[]).reduce(
      (sum, mock) => sum + mock.mock.calls.length,
      0,
    );

  const totalQueueCalls = () =>
    harness.queues.applicationPackage.add.mock.calls.length +
    harness.queues.icmStage.add.mock.calls.length +
    harness.queues.notification.add.mock.calls.length;

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
  });

  afterAll(async () => {
    await harness.stop();
  });

  describe('GET /application-package', () => {
    it('returns only the caller’s packages', async () => {
      const resA = await request(harness.httpServer)
        .get('/application-package')
        .set('Cookie', cookieA);

      expect(resA.status).toBe(200);
      const packagesA = resA.body as Array<{
        applicationPackageId: string;
      }>;
      const idsA = packagesA.map((p) => p.applicationPackageId);
      expect(idsA).toContain(world.packageA.applicationPackageId);
      expect(idsA).not.toContain(world.packageB.applicationPackageId);
    });

    it('rejects unauthenticated requests', async () => {
      const res = await request(harness.httpServer).get('/application-package');

      expect([401, 403]).toContain(res.status);
    });
  });

  describe('GET /application-package/:applicationPackageId', () => {
    it('allows the owner', async () => {
      const res = await request(harness.httpServer)
        .get(pkgUrl(world.packageA.applicationPackageId))
        .set('Cookie', cookieA);

      expect(res.status).toBe(200);
      const body = res.body as { applicationPackageId: string };
      expect(body.applicationPackageId).toBe(
        world.packageA.applicationPackageId,
      );
    });

    it('returns 404 for another applicant without leaking data', async () => {
      const res = await request(harness.httpServer)
        .get(pkgUrl(world.packageA.applicationPackageId))
        .set('Cookie', cookieB);

      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain(world.packageA.srId);
    });

    it('rejects unauthenticated requests', async () => {
      const res = await request(harness.httpServer).get(
        pkgUrl(world.packageA.applicationPackageId),
      );

      expect([401, 403]).toContain(res.status);
    });
  });

  describe('GET /:applicationPackageId/application-form', () => {
    it('allows the owner', async () => {
      const res = await request(harness.httpServer)
        .get(pkgUrl(world.packageA.applicationPackageId, '/application-form'))
        .set('Cookie', cookieA);

      expect(res.status).toBe(200);
      const forms = res.body as Array<{ applicationFormId: string }>;
      expect(forms.map((f) => f.applicationFormId)).toContain(
        world.formA.applicationFormId,
      );
    });

    it('returns no forms for another applicant (no leak)', async () => {
      const res = await request(harness.httpServer)
        .get(pkgUrl(world.packageA.applicationPackageId, '/application-form'))
        .set('Cookie', cookieB);

      expect(res.status).toBe(200);
      const forms = res.body as Array<{ applicationFormId: string }>;
      expect(forms).toHaveLength(0);
    });
  });

  describe('GET /:applicationPackageId/validate-household', () => {
    it('is reachable for the owner', async () => {
      const res = await request(harness.httpServer)
        .get(pkgUrl(world.packageA.applicationPackageId, '/validate-household'))
        .set('Cookie', cookieA);

      expect([200, 400]).toContain(res.status);
    });

    it('rejects another applicant', async () => {
      const res = await request(harness.httpServer)
        .get(pkgUrl(world.packageA.applicationPackageId, '/validate-household'))
        .set('Cookie', cookieB);

      expect([401, 403, 404]).toContain(res.status);
    });
  });

  describe('PATCH /:applicationPackageId', () => {
    it('rejects another applicant and leaves the package unchanged', async () => {
      const before = await packageDoc(world.packageA.applicationPackageId);
      const res = await request(harness.httpServer)
        .patch(pkgUrl(world.packageA.applicationPackageId))
        .set('Cookie', cookieB)
        .send({ hasPartner: true });

      expect(res.status).toBe(404);
      const after = await packageDoc(world.packageA.applicationPackageId);
      expect(after?.hasPartner).toBe(before?.hasPartner);
    });

    it('allows the owner to update', async () => {
      const res = await request(harness.httpServer)
        .patch(pkgUrl(world.packageA.applicationPackageId))
        .set('Cookie', cookieA)
        .send({ hasPartner: true });

      expect(res.status).toBe(200);
      const after = await packageDoc(world.packageA.applicationPackageId);
      expect(`${after?.hasPartner}`).toBe('true');
    });

    it('rejects unauthenticated requests', async () => {
      const res = await request(harness.httpServer)
        .patch(pkgUrl(world.packageA.applicationPackageId))
        .send({ hasPartner: true });

      expect([401, 403]).toContain(res.status);
    });
  });

  describe('DELETE /:applicationPackageId (cancel)', () => {
    it('rejects another applicant with no state change and no external side effects', async () => {
      const docBefore = await packageDoc(world.packageA.applicationPackageId);
      const siebelBefore = totalSiebelCalls();
      const queuesBefore = totalQueueCalls();

      const res = await request(harness.httpServer)
        .delete(pkgUrl(world.packageA.applicationPackageId))
        .set('Cookie', cookieB);

      expect(res.status).toBe(404);
      const docAfter = await packageDoc(world.packageA.applicationPackageId);
      expect(docAfter?.status).toBe(docBefore?.status);
      expect(totalSiebelCalls()).toBe(siebelBefore);
      expect(totalQueueCalls()).toBe(queuesBefore);
    });
  });

  describe('POST /:applicationPackageId/submit', () => {
    it('rejects another applicant with no state change and no external side effects', async () => {
      const docBefore = await packageDoc(world.packageA.applicationPackageId);
      const siebelBefore = totalSiebelCalls();
      const queuesBefore = totalQueueCalls();

      const res = await request(harness.httpServer)
        .post(pkgUrl(world.packageA.applicationPackageId, '/submit'))
        .set('Cookie', cookieB);

      expect(res.status).toBe(404);
      const docAfter = await packageDoc(world.packageA.applicationPackageId);
      expect(docAfter?.submissionAttempts).toBe(docBefore?.submissionAttempts);
      expect(docAfter?.status).toBe(docBefore?.status);
      expect(totalSiebelCalls()).toBe(siebelBefore);
      expect(totalQueueCalls()).toBe(queuesBefore);
    });
  });

  describe('POST /:applicationPackageId/request-info-session', () => {
    it('rejects another applicant with nothing enqueued', async () => {
      const queuesBefore = totalQueueCalls();

      const res = await request(harness.httpServer)
        .post(
          pkgUrl(world.packageA.applicationPackageId, '/request-info-session'),
        )
        .set('Cookie', cookieB)
        .send({ email: 'bob@example.com', home_phone: '(250) 555-0100' });

      expect(res.status).toBe(404);
      expect(totalQueueCalls()).toBe(queuesBefore);
    });

    it('rejects unauthenticated requests', async () => {
      const res = await request(harness.httpServer)
        .post(
          pkgUrl(world.packageA.applicationPackageId, '/request-info-session'),
        )
        .send({ email: 'bob@example.com', home_phone: '(250) 555-0100' });

      expect([401, 403]).toContain(res.status);
    });
  });

  describe('POST /:applicationPackageId/save-referral-contact', () => {
    it('rejects another applicant with no contact data written', async () => {
      const memberBefore = await harness.models.householdMember
        .findOne({
          householdMemberId: world.memberA.self.householdMemberId,
        })
        .lean();

      const res = await request(harness.httpServer)
        .post(
          pkgUrl(world.packageA.applicationPackageId, '/save-referral-contact'),
        )
        .set('Cookie', cookieB)
        .send({ email: 'hacker@example.com', home_phone: '(250) 555-0100' });

      expect(res.status).toBe(404);
      const memberAfter = await harness.models.householdMember
        .findOne({
          householdMemberId: world.memberA.self.householdMemberId,
        })
        .lean();
      expect((memberAfter as { email?: string } | null)?.email).toBe(
        (memberBefore as { email?: string } | null)?.email,
      );
    });
  });

  describe('POST /:applicationPackageId/lock-application', () => {
    it('rejects another applicant and does not lock the package', async () => {
      const docBefore = await packageDoc(world.packageA.applicationPackageId);

      const res = await request(harness.httpServer)
        .post(pkgUrl(world.packageA.applicationPackageId, '/lock-application'))
        .set('Cookie', cookieB);

      expect(res.status).toBe(404);
      const docAfter = await packageDoc(world.packageA.applicationPackageId);
      expect(docAfter?.status).toBe(docBefore?.status);
    });
  });

  describe('POST /:applicationPackageId/upload-medical-assessments', () => {
    it('rejects another applicant with no state change and no external side effects', async () => {
      const docBefore = await packageDoc(world.packageA.applicationPackageId);
      const siebelBefore = totalSiebelCalls();

      const res = await request(harness.httpServer)
        .post(
          pkgUrl(
            world.packageA.applicationPackageId,
            '/upload-medical-assessments',
          ),
        )
        .set('Cookie', cookieB);

      expect(res.status).toBe(404);
      const docAfter = await packageDoc(world.packageA.applicationPackageId);
      expect(docAfter?.hasMedicalAssessment).toBe(
        docBefore?.hasMedicalAssessment,
      );
      expect(totalSiebelCalls()).toBe(siebelBefore);
    });
  });

  describe('POST /:applicationPackageId/submit-training-certificates', () => {
    it('rejects another applicant with no state change and no external side effects', async () => {
      const docBefore = await packageDoc(world.packageA.applicationPackageId);
      const siebelBefore = totalSiebelCalls();
      const queuesBefore = totalQueueCalls();

      const res = await request(harness.httpServer)
        .post(
          pkgUrl(
            world.packageA.applicationPackageId,
            '/submit-training-certificates',
          ),
        )
        .set('Cookie', cookieB);

      expect(res.status).toBe(404);
      const docAfter = await packageDoc(world.packageA.applicationPackageId);
      expect(docAfter?.hasTrainingCertificates).toBe(
        docBefore?.hasTrainingCertificates,
      );
      expect(totalSiebelCalls()).toBe(siebelBefore);
      expect(totalQueueCalls()).toBe(queuesBefore);
    });
  });

  describe('POST /:applicationPackageId/submit-documents-to-icm', () => {
    it('rejects another applicant with no state change and no external side effects', async () => {
      const siebelBefore = totalSiebelCalls();

      const res = await request(harness.httpServer)
        .post(
          pkgUrl(
            world.packageA.applicationPackageId,
            '/submit-documents-to-icm',
          ),
        )
        .set('Cookie', cookieB)
        .send({
          householdMemberId: world.memberA.child.householdMemberId,
          attachmentType: AttachmentType.DISCLOSURECONSENT,
        });

      expect(res.status).toBe(404);
      expect(totalSiebelCalls()).toBe(siebelBefore);
    });
  });

  describe('POST /application-package (create)', () => {
    it('creates a package owned by the caller', async () => {
      const res = await request(harness.httpServer)
        .post('/application-package')
        .set('Cookie', cookieA)
        .send({
          subtype: ApplicationPackageSubType.FCH,
          subsubtype: ApplicationPackageSubSubType.FCH,
        });

      expect([200, 201]).toContain(res.status);
      const body = res.body as { userId: string };
      expect(body.userId).toBe(world.userA.userId);
    });

    it('ignores a body userId targeting another applicant (server-wins)', async () => {
      const res = await request(harness.httpServer)
        .post('/application-package')
        .set('Cookie', cookieA)
        .send({
          userId: world.userB.userId,
          subtype: ApplicationPackageSubType.FCH,
          subsubtype: ApplicationPackageSubSubType.FCH,
        });

      expect([200, 201]).toContain(res.status);
      const body = res.body as { userId: string };
      expect(body.userId).toBe(world.userA.userId);
    });

    it('rejects unauthenticated requests', async () => {
      const res = await request(harness.httpServer)
        .post('/application-package')
        .send({
          subtype: ApplicationPackageSubType.FCH,
          subsubtype: ApplicationPackageSubSubType.FCH,
        });

      expect([401, 403]).toContain(res.status);
    });
  });

  describe('POST /application-package/access-code/redeem', () => {
    it('does not redeem another applicant’s code', async () => {
      const res = await request(harness.httpServer)
        .post('/application-package/access-code/redeem')
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
    });

    it('rejects unauthenticated requests', async () => {
      const res = await request(harness.httpServer)
        .post('/application-package/access-code/redeem')
        .send({ accessCode: world.accessCodeB.code });

      expect([401, 403]).toContain(res.status);
    });
  });

  describe('POST /application-package/in-service-training/submit', () => {
    it('rejects users without an active resource case', async () => {
      const res = await request(harness.httpServer)
        .post('/application-package/in-service-training/submit')
        .set('Cookie', cookieB);

      expect(res.status).toBe(400);
    });
  });
});
