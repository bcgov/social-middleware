import * as request from 'supertest';
import {
  AuthorizationHarness,
  mintSessionCookie,
  mintTamperedSessionCookie,
  startAuthorizationApp,
} from './helpers/authorization-harness';
import { seedTwoApplicants } from './helpers/authorization-seed';

describe('Authorization harness (smoke)', () => {
  let harness: AuthorizationHarness;

  beforeAll(async () => {
    harness = await startAuthorizationApp();
    await seedTwoApplicants(harness.models);
  });

  afterAll(async () => {
    await harness.stop();
  });

  it('boots the real module graph with real guards and pipes', () => {
    expect(harness.app).toBeDefined();
  });

  it('rejects an unauthenticated request with 401/403', async () => {
    const res = await request(harness.httpServer).get('/application-forms');

    expect([401, 403]).toContain(res.status);
  });

  it('rejects a tampered session cookie', async () => {
    const res = await request(harness.httpServer)
      .get('/application-forms')
      .set(
        'Cookie',
        mintTamperedSessionCookie({
          userId: 'x',
          sub: 'x',
          email: 'x@x.com',
          name: 'X',
        }),
      );

    expect([401, 403]).toContain(res.status);
  });

  it('rejects a blacklisted session token', async () => {
    const world = { userA: { userId: 'x', sub: 'x', email: 'x@x.com' } };
    const { cookie, jti } = mintSessionCookie({
      userId: world.userA.userId,
      sub: world.userA.sub,
      email: world.userA.email,
      name: 'X',
    });
    harness.blacklistedJtis.add(jti);

    const res = await request(harness.httpServer)
      .get('/application-forms')
      .set('Cookie', cookie);

    expect([401, 403]).toContain(res.status);
  });
});
