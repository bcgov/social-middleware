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

describe('Application forms cross-applicant authorization', () => {
  let harness: AuthorizationHarness;
  let world: AuthorizationWorld;
  let cookieA: string;
  let cookieB: string;

  const appQueueCalls = () =>
    harness.queues.applicationPackage.add.mock.calls.length;

  const siebelCalls = () =>
    (Object.values(harness.siebel) as jest.Mock[]).reduce(
      (sum, mock) => sum + mock.mock.calls.length,
      0,
    );

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

  describe('GET /application-forms (screening list)', () => {
    it('returns no screening forms for the primary applicant', async () => {
      const res = await request(harness.httpServer)
        .get('/application-forms')
        .set('Cookie', cookieA);

      expect(res.status).toBe(200);
      const forms = (
        res.body as unknown as Array<Array<{ applicationFormId: string }>>
      ).flat();
      expect(forms).toHaveLength(0);
    });

    it('returns only the household member’s own screening forms', async () => {
      const cookieM = mintSessionCookie({
        userId: world.userM.userId,
        sub: world.userM.bcServicesCardId,
        email: world.userM.email,
        name: 'Mia MEMBER',
      }).cookie;

      const res = await request(harness.httpServer)
        .get('/application-forms')
        .set('Cookie', cookieM);

      expect(res.status).toBe(200);
      const forms = (
        res.body as unknown as Array<Array<{ applicationFormId: string }>>
      ).flat();
      const ids = forms.map((f) => f.applicationFormId);
      expect(ids).not.toContain(world.formB.applicationFormId);

      const linkedForms = await harness.models.applicationForm
        .find({ householdMemberId: world.memberA.linked.householdMemberId })
        .lean();
      for (const form of linkedForms as Array<{ applicationFormId: string }>) {
        expect(ids).toContain(form.applicationFormId);
      }
    });

    it('rejects unauthenticated requests (guard regression)', async () => {
      const res = await request(harness.httpServer).get('/application-forms');

      expect([401, 403]).toContain(res.status);
    });
  });

  describe('GET /application-forms/token (mint)', () => {
    it('mints a token for the form owner', async () => {
      const res = await request(harness.httpServer)
        .get('/application-forms/token')
        .query({ applicationFormId: world.formA.applicationFormId })
        .set('Cookie', cookieA);

      expect(res.status).toBe(200);
      const body = res.body as { formAccessToken: string };
      expect(typeof body.formAccessToken).toBe('string');
      expect(body.formAccessToken.length).toBeGreaterThan(0);
    });

    it('refuses to mint a token for another applicant’s form', async () => {
      const res = await request(harness.httpServer)
        .get('/application-forms/token')
        .query({ applicationFormId: world.formB.applicationFormId })
        .set('Cookie', cookieA);

      expect(res.status).toBe(401);
      const body = res.body as Record<string, unknown>;
      expect(body.formAccessToken).toBeUndefined();
    });

    it('rejects unauthenticated requests', async () => {
      const res = await request(harness.httpServer)
        .get('/application-forms/token')
        .query({ applicationFormId: world.formA.applicationFormId });

      expect([401, 403]).toContain(res.status);
    });
  });

  describe('GET /application-forms/:applicationFormId', () => {
    it('allows the form owner', async () => {
      const res = await request(harness.httpServer)
        .get(`/application-forms/${world.formA.applicationFormId}`)
        .set('Cookie', cookieA);

      expect(res.status).toBe(200);
    });

    it('rejects another applicant', async () => {
      const res = await request(harness.httpServer)
        .get(`/application-forms/${world.formB.applicationFormId}`)
        .set('Cookie', cookieA);

      expect(res.status).toBe(401);
    });

    it('rejects the other applicant in the opposite direction', async () => {
      const res = await request(harness.httpServer)
        .get(`/application-forms/${world.formA.applicationFormId}`)
        .set('Cookie', cookieB);

      expect(res.status).toBe(401);
    });

    it('rejects unauthenticated requests', async () => {
      const res = await request(harness.httpServer).get(
        `/application-forms/${world.formB.applicationFormId}`,
      );

      expect([401, 403]).toContain(res.status);
    });
  });

  describe('GET /application-forms/household/:householdMemberId', () => {
    it('allows the household member themselves', async () => {
      const cookieM = mintSessionCookie({
        userId: world.userM.userId,
        sub: world.userM.bcServicesCardId,
        email: world.userM.email,
        name: 'Mia MEMBER',
      }).cookie;

      const res = await request(harness.httpServer)
        .get(
          `/application-forms/household/${world.memberA.linked.householdMemberId}`,
        )
        .set('Cookie', cookieM);

      expect(res.status).toBe(200);
    });

    it('rejects even the package owner (member-self only route)', async () => {
      const res = await request(harness.httpServer)
        .get(
          `/application-forms/household/${world.memberA.linked.householdMemberId}`,
        )
        .set('Cookie', cookieA);

      expect(res.status).toBe(401);
    });

    it('rejects another applicant', async () => {
      const res = await request(harness.httpServer)
        .get(
          `/application-forms/household/${world.memberB.self.householdMemberId}`,
        )
        .set('Cookie', cookieA);

      expect(res.status).toBe(401);
    });

    it('rejects unauthenticated requests', async () => {
      const res = await request(harness.httpServer).get(
        `/application-forms/household/${world.memberA.linked.householdMemberId}`,
      );

      expect([401, 403]).toContain(res.status);
    });
  });

  describe('POST /application-forms/:applicationFormId/clone', () => {
    it('rejects another applicant and creates nothing for their package', async () => {
      const formsOnPkgBBefore = await harness.models.applicationForm
        .countDocuments({
          applicationPackageId: world.packageB.applicationPackageId,
        })
        .exec();

      const res = await request(harness.httpServer)
        .post(`/application-forms/${world.formB.applicationFormId}/clone`)
        .set('Cookie', cookieA);

      expect(res.status).toBe(401);
      await expect(
        harness.models.applicationForm
          .countDocuments({
            applicationPackageId: world.packageB.applicationPackageId,
          })
          .exec(),
      ).resolves.toBe(formsOnPkgBBefore);
    });

    it('allows the owner to clone their own form', async () => {
      const res = await request(harness.httpServer)
        .post(`/application-forms/${world.formA.applicationFormId}/clone`)
        .set('Cookie', cookieA);

      expect([200, 201]).toContain(res.status);
    });

    it('rejects unauthenticated requests', async () => {
      const res = await request(harness.httpServer).post(
        `/application-forms/${world.formA.applicationFormId}/clone`,
      );

      expect([401, 403]).toContain(res.status);
    });
  });

  describe('POST /application-forms/:applicationFormId/submit-to-icm', () => {
    it('rejects another applicant with no queue or Siebel activity', async () => {
      const queueBefore = appQueueCalls();
      const siebelBefore = siebelCalls();

      const res = await request(harness.httpServer)
        .post(
          `/application-forms/${world.formB.applicationFormId}/submit-to-icm`,
        )
        .set('Cookie', cookieA);

      expect(res.status).toBe(401);
      expect(appQueueCalls()).toBe(queueBefore);
      expect(siebelCalls()).toBe(siebelBefore);
    });

    it('allows the owner and queues the resubmission', async () => {
      const queueBefore = appQueueCalls();

      const res = await request(harness.httpServer)
        .post(
          `/application-forms/${world.formA.applicationFormId}/submit-to-icm`,
        )
        .set('Cookie', cookieA);

      expect([200, 201]).toContain(res.status);
      expect(appQueueCalls()).toBeGreaterThan(queueBefore);
    });

    it('rejects unauthenticated requests', async () => {
      const res = await request(harness.httpServer).post(
        `/application-forms/${world.formA.applicationFormId}/submit-to-icm`,
      );

      expect([401, 403]).toContain(res.status);
    });
  });

  describe('DELETE /application-forms/:applicationFormId', () => {
    it('rejects another applicant and leaves the form intact', async () => {
      const res = await request(harness.httpServer)
        .delete(`/application-forms/${world.formB.applicationFormId}`)
        .set('Cookie', cookieA);

      expect(res.status).toBe(401);
      const record = await harness.models.applicationForm
        .findOne({ applicationFormId: world.formB.applicationFormId })
        .lean();
      expect(record).not.toBeNull();
    });

    it('rejects unauthenticated requests', async () => {
      const res = await request(harness.httpServer).delete(
        `/application-forms/${world.formB.applicationFormId}`,
      );

      expect([401, 403]).toContain(res.status);
    });
  });

  describe('token-keyed writes (no session — capability semantics)', () => {
    it('accepts a valid token for submit without any session', async () => {
      const res = await request(harness.httpServer)
        .post('/application-forms/submit')
        .send({
          token: world.formA.accessToken,
          jsonToSave: 'eyJxIjoiYiJ9',
        });

      expect([200, 201]).toContain(res.status);
    });

    it('accepts a valid token for saveDraft without any session', async () => {
      const res = await request(harness.httpServer)
        .post('/application-forms/saveDraft')
        .send({
          token: world.formA.accessToken,
          jsonToSave: 'eyJxIjoiYyJ9',
        });

      expect([200, 201]).toContain(res.status);
    });

    it('rejects an unknown token for submit', async () => {
      const res = await request(harness.httpServer)
        .post('/application-forms/submit')
        .send({
          token: '00000000-0000-4000-8000-000000000000',
          jsonToSave: 'e30=',
        });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /forms token-gated routes', () => {
    it('returns the form parameters for a valid token', async () => {
      const res = await request(harness.httpServer)
        .post('/forms/validateTokenAndGetParameters')
        .send({ token: world.formA.accessToken });

      expect([200, 201]).toContain(res.status);
      const body = res.body as { appCode: string };
      expect(body.appCode).toBe('TEST-FORM');
    });

    it('returns the saved form data for a valid token', async () => {
      const res = await request(harness.httpServer)
        .post('/forms/validateTokenAndGetSavedJson')
        .send({ token: world.formA.accessToken });

      expect([200, 201]).toContain(res.status);
      const body = res.body as { formJson: string };
      expect(typeof body.formJson).toBe('string');
    });

    it('rejects unknown tokens on both routes', async () => {
      const paramsRes = await request(harness.httpServer)
        .post('/forms/validateTokenAndGetParameters')
        .send({ token: 'not-a-real-token' });
      expect(paramsRes.status).toBe(404);

      const savedRes = await request(harness.httpServer)
        .post('/forms/validateTokenAndGetSavedJson')
        .send({ token: 'not-a-real-token' });
      expect(savedRes.status).toBe(404);
    });

    it('tombstone-data returns the token holder’s own PII only', async () => {
      const mint = await request(harness.httpServer)
        .get('/application-forms/token')
        .query({ applicationFormId: world.formA.applicationFormId })
        .set('Cookie', cookieA);
      const freshToken = (mint.body as { formAccessToken: string })
        .formAccessToken;

      const ownRes = await request(harness.httpServer)
        .post('/forms/tombstone-data')
        .send({ formAccessToken: freshToken });

      expect([200, 201]).toContain(ownRes.status);
      const own = ownRes.body as { first_name: string };
      expect(own.first_name).toBe('Alice');

      const otherRes = await request(harness.httpServer)
        .post('/forms/tombstone-data')
        .send({ formAccessToken: world.formB.accessToken });

      expect([200, 201]).toContain(otherRes.status);
      const other = otherRes.body as { first_name: string };
      expect(other.first_name).toBe('Bob');
    });

    it('rejects unknown tokens on tombstone-data', async () => {
      const res = await request(harness.httpServer)
        .post('/forms/tombstone-data')
        .send({ formAccessToken: 'not-a-real-token' });

      expect(res.status).toBe(404);
    });
  });
});
