import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { SessionAuthGuard } from '../session-auth.guard';
import { TokenBlacklistService } from '../services/token-blacklist.service';

jest.mock('jsonwebtoken');
const mockJwt = jwt as jest.Mocked<typeof jwt>;

describe('SessionAuthGuard', () => {
  let guard: SessionAuthGuard;
  let mockTokenBlacklistService: TokenBlacklistService;

  const mockConfigService = {
    get: jest.fn().mockReturnValue('test-secret'),
  } as unknown as ConfigService;

  const validPayload = {
    sub: 'user-sub-123',
    email: 'test@example.com',
    name: 'Test User',
    userId: 'db-id-456',
    jti: 'token-jti-abc',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
  };

  const makeContext = (cookies: Record<string, string> = {}) => {
    const request: Record<string, unknown> = { cookies };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      _request: request,
    } as unknown as ExecutionContext & { _request: Record<string, unknown> };
  };

  beforeEach(() => {
    mockTokenBlacklistService = {
      isBlacklisted: jest.fn().mockResolvedValue(false),
      blacklist: jest.fn().mockResolvedValue(undefined),
    } as unknown as TokenBlacklistService;

    guard = new SessionAuthGuard(mockConfigService, mockTokenBlacklistService);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns true and attaches user to request when token is valid', async () => {
    mockJwt.verify.mockReturnValue(validPayload as any);
    const ctx = makeContext({ app_session: 'valid.jwt.token' });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(ctx._request.user).toMatchObject({
      sub: validPayload.sub,
      email: validPayload.email,
    });
  });

  it('returns false when no session cookie is present', async () => {
    const ctx = makeContext({});

    const result = await guard.canActivate(ctx);

    expect(result).toBe(false);
    expect(mockJwt.verify).not.toHaveBeenCalled();
  });

  it('returns false when token is on the blacklist', async () => {
    mockJwt.verify.mockReturnValue(validPayload as any);
    jest
      .mocked(mockTokenBlacklistService.isBlacklisted)
      .mockResolvedValue(true);
    const ctx = makeContext({ app_session: 'blacklisted.token' });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(false);
  });

  it('returns false when JWT verification throws', async () => {
    mockJwt.verify.mockImplementation(() => {
      throw new Error('invalid token');
    });
    const ctx = makeContext({ app_session: 'bad.token' });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(false);
  });

  it('skips blacklist check when jti is absent', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { jti: _jti, ...payloadNoJti } = validPayload;
    mockJwt.verify.mockReturnValue(payloadNoJti as any);
    const ctx = makeContext({ app_session: 'valid.token' });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(mockTokenBlacklistService.isBlacklisted).not.toHaveBeenCalled();
  });
});
