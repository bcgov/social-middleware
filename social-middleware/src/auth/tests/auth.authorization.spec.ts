import * as request from 'supertest';
import {
  AuthorizationHarness,
  mintSessionCookie,
  mintTamperedSessionCookie,
  startAuthorizationApp,
} from './helpers/authorization-harness';
import {
  AuthorizationWorld,
  seedTwoApplicants,
} from './helpers/authorization-seed';

describe('Auth profile cross-applicant authorization', () => {
  let harness: AuthorizationHarness;
  let world: AuthorizationWorld;

  const cookieFor = (user: {
    userId: string;
    bcServicesCardId: string;
    email: string;
    firstName: string;
    lastName: string;
  }) =>
    mintSessionCookie({
      userId: user.userId,
      sub: user.bcServicesCardId,
      email: user.email,
      name: `${user.firstName} ${user.lastName}`,
    }).cookie;

  beforeAll(async () => {
    harness = await startAuthorizationApp();
    world = await seedTwoApplicants(harness.models);
  });

  afterAll(async () => {
    delete process.env.TEST_RESOURCE_CASE;
    await harness.stop();
  });

  describe('GET /auth/profile', () => {
    it('returns only the caller’s own profile data', async () => {
      const res = await request(harness.httpServer)
        .get('/auth/profile')
        .set('Cookie', cookieFor(world.userA));

      expect(res.status).toBe(200);
      const body = res.body as {
        first_name: string;
        email: string;
      };
      expect(body.first_name).toBe('Alice');
      expect(body.email).toBe(world.userA.email);
      expect(JSON.stringify(res.body)).not.toContain('Bob');
      expect(JSON.stringify(res.body)).not.toContain(world.userB.email);
    });

    it('returns the other applicant’s own data to them, not Alice’s', async () => {
      const res = await request(harness.httpServer)
        .get('/auth/profile')
        .set('Cookie', cookieFor(world.userB));

      expect(res.status).toBe(200);
      const body = res.body as { first_name: string };
      expect(body.first_name).toBe('Bob');
      expect(JSON.stringify(res.body)).not.toContain('Alice');
    });

    it('rejects unauthenticated requests', async () => {
      const res = await request(harness.httpServer).get('/auth/profile');

      expect([401, 403]).toContain(res.status);
    });

    it('rejects a tampered session cookie', async () => {
      const res = await request(harness.httpServer)
        .get('/auth/profile')
        .set(
          'Cookie',
          mintTamperedSessionCookie({
            userId: world.userA.userId,
            sub: world.userA.bcServicesCardId,
            email: world.userA.email,
            name: 'Alice APPLICANT',
          }),
        );

      expect([401, 403]).toContain(res.status);
    });

    it('rejects a blacklisted (logged-out) session token', async () => {
      const { cookie, jti } = mintSessionCookie({
        userId: world.userA.userId,
        sub: world.userA.bcServicesCardId,
        email: world.userA.email,
        name: 'Alice APPLICANT',
      });
      harness.blacklistedJtis.add(jti);

      const res = await request(harness.httpServer)
        .get('/auth/profile')
        .set('Cookie', cookie);

      expect([401, 403]).toContain(res.status);
    });

    it('returns 404 for a session whose user record no longer exists', async () => {
      const res = await request(harness.httpServer)
        .get('/auth/profile')
        .set(
          'Cookie',
          mintSessionCookie({
            userId: '000000000000000000000000',
            sub: 'bcsc-ghost',
            email: 'ghost@example.com',
            name: 'Ghost User',
          }).cookie,
        );

      expect(res.status).toBe(404);
    });
  });

  describe('GET /auth/profile resource-case flag gating', () => {
    it('omits resource-case fields when TEST_RESOURCE_CASE is off', async () => {
      const res = await request(harness.httpServer)
        .get('/auth/profile')
        .set('Cookie', cookieFor(world.userA));

      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain(
        'non_key_player_caregiver',
      );
      expect(JSON.stringify(res.body)).not.toContain(
        'resource_case_active_date',
      );
    });

    it('includes resource-case fields when TEST_RESOURCE_CASE is on', async () => {
      await harness.models.user.updateOne(
        { bc_services_card_id: world.userA.bcServicesCardId },
        { $set: { resource_case_active_date: new Date('2026-08-01') } },
      );
      process.env.TEST_RESOURCE_CASE = 'true';

      const res = await request(harness.httpServer)
        .get('/auth/profile')
        .set('Cookie', cookieFor(world.userA));

      expect(res.status).toBe(200);
      const body = res.body as {
        non_key_player_caregiver: unknown;
        resource_case_active_date: string;
      };
      expect(body).toHaveProperty('non_key_player_caregiver');
      expect(body.resource_case_active_date).toBeDefined();
    });
  });
});
