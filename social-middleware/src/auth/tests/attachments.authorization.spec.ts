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

describe('Attachments cross-applicant authorization', () => {
  let harness: AuthorizationHarness;
  let world: AuthorizationWorld;
  let cookieA: string;
  let cookieB: string;

  const attachmentBody = (overrides: Record<string, unknown> = {}) => ({
    attachmentType: AttachmentType.MEDICAL_ASSESSMENT,
    fileName: 'authorization-test.pdf',
    fileType: 'pdf',
    fileData: 'ZGF0YQ==',
    ...overrides,
  });

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

  describe('POST /attachments', () => {
    it('allows the owner to upload an attachment referencing their own package', async () => {
      const res = await request(harness.httpServer)
        .post('/attachments')
        .set('Cookie', cookieA)
        .send(
          attachmentBody({
            applicationPackageId: world.packageA.applicationPackageId,
          }),
        );

      expect([200, 201]).toContain(res.status);
    });

    it('rejects an upload referencing another applicant’s package (body mismatch)', async () => {
      const onPkgBBefore = await harness.models.attachment
        .countDocuments({
          applicationPackageId: world.packageB.applicationPackageId,
        })
        .exec();

      const res = await request(harness.httpServer)
        .post('/attachments')
        .set('Cookie', cookieA)
        .send(
          attachmentBody({
            applicationPackageId: world.packageB.applicationPackageId,
          }),
        );

      expect([401, 403]).toContain(res.status);
      await expect(
        harness.models.attachment
          .countDocuments({
            applicationPackageId: world.packageB.applicationPackageId,
          })
          .exec(),
      ).resolves.toBe(onPkgBBefore);
    });

    it('rejects an upload referencing another applicant’s household member', async () => {
      const onMemberBBefore = await harness.models.attachment
        .countDocuments({
          householdMemberId: world.memberB.self.householdMemberId,
        })
        .exec();

      const res = await request(harness.httpServer)
        .post('/attachments')
        .set('Cookie', cookieA)
        .send(
          attachmentBody({
            householdMemberId: world.memberB.self.householdMemberId,
          }),
        );

      expect([401, 403]).toContain(res.status);
      await expect(
        harness.models.attachment
          .countDocuments({
            householdMemberId: world.memberB.self.householdMemberId,
          })
          .exec(),
      ).resolves.toBe(onMemberBBefore);
    });

    it('rejects unauthenticated requests', async () => {
      const res = await request(harness.httpServer)
        .post('/attachments')
        .send(
          attachmentBody({
            applicationPackageId: world.packageA.applicationPackageId,
          }),
        );

      expect([401, 403]).toContain(res.status);
    });
  });

  describe('GET /attachments/application-package/:applicationPackageId', () => {
    it('returns the owner’s attachments for their own package', async () => {
      const res = await request(harness.httpServer)
        .get(
          `/attachments/application-package/${world.packageA.applicationPackageId}`,
        )
        .set('Cookie', cookieA);

      expect(res.status).toBe(200);
      const attachments = res.body as Array<{ attachmentId: string }>;
      expect(attachments.map((a) => a.attachmentId)).toContain(
        world.attachmentA.attachmentId,
      );
    });

    it('returns an empty list for another applicant’s package (no leak)', async () => {
      const res = await request(harness.httpServer)
        .get(
          `/attachments/application-package/${world.packageB.applicationPackageId}`,
        )
        .set('Cookie', cookieA);

      expect(res.status).toBe(200);
      const attachments = res.body as Array<{ attachmentId: string }>;
      expect(attachments).toHaveLength(0);
    });
  });

  describe('GET /attachments/household-member/:householdMemberId', () => {
    it('allows the package owner', async () => {
      const res = await request(harness.httpServer)
        .get(
          `/attachments/household-member/${world.memberA.linked.householdMemberId}`,
        )
        .set('Cookie', cookieA);

      expect(res.status).toBe(200);
    });

    it('rejects another applicant with 403', async () => {
      const res = await request(harness.httpServer)
        .get(
          `/attachments/household-member/${world.memberA.linked.householdMemberId}`,
        )
        .set('Cookie', cookieB);

      expect([401, 403]).toContain(res.status);
    });
  });

  describe('GET /attachments/:attachmentId', () => {
    it('allows the owner to download their own attachment', async () => {
      const res = await request(harness.httpServer)
        .get(`/attachments/${world.attachmentA.attachmentId}`)
        .set('Cookie', cookieA);

      expect(res.status).toBe(200);
      const body = res.body as { attachmentId: string };
      expect(body.attachmentId).toBe(world.attachmentA.attachmentId);
    });

    it('does not leak another applicant’s attachment', async () => {
      const res = await request(harness.httpServer)
        .get(`/attachments/${world.attachmentB.attachmentId}`)
        .set('Cookie', cookieA);

      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('medical-bob.pdf');
    });
  });

  describe('DELETE /attachments/:attachmentId', () => {
    it('rejects another applicant and leaves the record intact', async () => {
      const res = await request(harness.httpServer)
        .delete(`/attachments/${world.attachmentA.attachmentId}`)
        .set('Cookie', cookieB);

      expect(res.status).toBe(404);
      const record = await harness.models.attachment
        .findOne({ attachmentId: world.attachmentA.attachmentId })
        .lean();
      expect(record).not.toBeNull();
    });

    it('allows the owner to delete their own attachment', async () => {
      const res = await request(harness.httpServer)
        .delete(`/attachments/${world.attachmentA.attachmentId}`)
        .set('Cookie', cookieA);

      expect([200, 201]).toContain(res.status);
      const record = await harness.models.attachment
        .findOne({ attachmentId: world.attachmentA.attachmentId })
        .lean();
      expect(record).toBeNull();
    });
  });

  describe('in-service training attachments', () => {
    it('rejects users without an active resource case', async () => {
      const res = await request(harness.httpServer)
        .post('/attachments/in-service-training')
        .set('Cookie', cookieA)
        .send(attachmentBody());

      expect(res.status).toBe(400);
    });

    it('allows a user with an active resource case and scopes reads to them', async () => {
      await harness.models.user.updateOne(
        { bc_services_card_id: world.userA.bcServicesCardId },
        { $set: { resource_case_id: 'RC-AUTH-001' } },
      );

      const upload = await request(harness.httpServer)
        .post('/attachments/in-service-training')
        .set('Cookie', cookieA)
        .send(attachmentBody());

      expect([200, 201]).toContain(upload.status);

      const listRes = await request(harness.httpServer)
        .get('/attachments/in-service-training')
        .set('Cookie', cookieA);

      expect(listRes.status).toBe(200);
      const list = listRes.body as Array<{ uploadedBy: string }>;
      expect(list.length).toBeGreaterThan(0);
      for (const item of list) {
        expect(item.uploadedBy).toBe(world.userA.userId);
      }
    });
  });
});
