import { HttpStatus } from '@nestjs/common';
import { KongOidcAuthStrategy } from '../strategies/kong-oidc-auth.strategy';

const mockUserInfo = {
  sub: 'user-sub-123',
  email: 'test@example.com',
  name: 'Test User',
  given_names: 'Test',
  family_name: 'User',
  birthdate: '1990-01-15',
  address: {
    street_address: '123 Main St',
    country: 'CA',
    region: 'BC',
    locality: 'Victoria',
    postal_code: 'V8W 1A1',
  },
};

const encodedUserInfo = Buffer.from(JSON.stringify(mockUserInfo)).toString(
  'base64',
);

describe('KongOidcAuthStrategy', () => {
  let strategy: KongOidcAuthStrategy;

  const mockConfigService = {
    get: jest.fn(
      (key: string, defaultValue?: string) =>
        ({
          JWT_SECRET: 'test-secret',
          NODE_ENV: 'test',
          FRONTEND_URL: 'http://localhost:3000',
          COOKIE_DOMAIN: '',
          MIDDLEWARE_URL: 'http://localhost:3001',
        })[key] ??
        defaultValue ??
        '',
    ),
  };

  const mockUserService = {
    findOrCreate: jest
      .fn()
      .mockResolvedValue({ id: 'user-id-123', email: 'test@example.com' }),
    updateLastLogin: jest.fn().mockResolvedValue(undefined),
  };

  const mockAuthService = { login: jest.fn().mockResolvedValue(undefined) };
  const mockUserUtil = {
    icmDateFormat: jest.fn().mockReturnValue('01/15/1990'),
  };
  const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    setContext: jest.fn(),
  };
  const mockTokenBlacklistService = {
    isBlacklisted: jest.fn().mockResolvedValue(false),
    blacklist: jest.fn().mockResolvedValue(undefined),
  };

  const mockReq = (overrides = {}) =>
    ({
      headers: {},
      cookies: {},
      query: {},
      ...overrides,
    }) as unknown as Parameters<typeof strategy.handleLogin>[0];

  const mockRes = () =>
    ({
      cookie: jest.fn().mockReturnThis(),
      clearCookie: jest.fn().mockReturnThis(),
      redirect: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    }) as unknown as Parameters<typeof strategy.handleLogin>[1];

  beforeEach(() => {
    strategy = new KongOidcAuthStrategy(
      mockConfigService as any,
      mockUserService as any,
      mockAuthService as any,
      mockUserUtil as any,
      mockLogger as any,
      mockTokenBlacklistService as any,
    );
    jest
      .spyOn(strategy as any, 'createUserSession')
      .mockResolvedValue(undefined);
  });

  afterEach(() => jest.clearAllMocks());

  describe('handleLogin', () => {
    it('creates a session and redirects to auth callback when X-Userinfo is valid', async () => {
      const req = mockReq({
        headers: { 'x-userinfo': encodedUserInfo },
        cookies: {},
      });
      const res = mockRes();

      await strategy.handleLogin(req, res);

      expect((strategy as any).createUserSession).toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/auth/callback',
      );
    });

    it('redirects with not_authenticated error when X-Userinfo is missing', async () => {
      const req = mockReq({ headers: {}, cookies: {} });
      const res = mockRes();

      await strategy.handleLogin(req, res);

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('not_authenticated'),
      );
      expect((strategy as any).createUserSession).not.toHaveBeenCalled();
    });

    it('uses the first value when X-Userinfo is an array', async () => {
      const req = mockReq({
        headers: { 'x-userinfo': [encodedUserInfo, 'ignored'] },
        cookies: {},
      });
      const res = mockRes();

      await strategy.handleLogin(req, res);

      expect((strategy as any).createUserSession).toHaveBeenCalled();
    });
  });

  describe('handleGetCallback', () => {
    it('creates a session and redirects to auth callback on valid X-Userinfo', async () => {
      const req = mockReq({
        headers: { 'x-userinfo': encodedUserInfo },
        query: {},
        cookies: {},
      });
      const res = mockRes();

      await strategy.handleGetCallback(req, res);

      expect((strategy as any).createUserSession).toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/auth/callback',
      );
    });

    it('redirects with oidc_failed error when X-Userinfo is missing', async () => {
      const req = mockReq({ headers: {}, query: {}, cookies: {} });
      const res = mockRes();

      await strategy.handleGetCallback(req, res);

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('oidc_failed'),
      );
      expect((strategy as any).createUserSession).not.toHaveBeenCalled();
    });
  });

  describe('handlePostCallback', () => {
    it('returns 400 — POST is not supported in Kong OIDC mode', async () => {
      const res = mockRes();

      await strategy.handlePostCallback({} as any, res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining<{ error: unknown }>({
          error: expect.any(String),
        }),
      );
    });
  });

  describe('handleLogout', () => {
    it('blacklists the current token', () => {
      const blacklistSpy = jest.spyOn(strategy as any, 'blacklistCurrentToken');
      const req = mockReq({ cookies: {} });

      strategy.handleLogout(req, mockRes());

      expect(blacklistSpy).toHaveBeenCalledWith(req);
    });

    it('clears the session cookie', () => {
      const res = mockRes();

      strategy.handleLogout({ cookies: {} } as any, res);

      expect(res.clearCookie).toHaveBeenCalledWith(
        'app_session',
        expect.any(Object),
      );
    });

    it('redirects to the Kong logout endpoint', () => {
      const res = mockRes();

      strategy.handleLogout({ cookies: {} } as any, res);

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('/logout'),
      );
    });
  });
});
