import { HttpStatus } from '@nestjs/common';
import { BcscOAuthAuthStrategy } from '../strategies/bcsc-oauth-auth.strategy';
import { ConfigService } from '@nestjs/config';
import { UserService } from '../user.service';
import { AuthService } from '../auth.service';
import { BcscOAuthService } from '../bcsc-oauth.service';
import { TokenBlacklistService } from '../services/token-blacklist.service';
import { UserUtil } from '../../common/utils/user.util';
import { PinoLogger } from 'nestjs-pino';

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

const mockTokens = {
  access_token: 'access-token-abc',
  id_token: 'id-token-xyz',
  token_type: 'Bearer',
  expires_in: 3600,
};

const validPKCE = {
  codeVerifier: 'verifier-abc',
  codeChallenge: 'challenge-abc',
  state: 'state-abc',
};

describe('BcscOAuthAuthStrategy', () => {
  let strategy: BcscOAuthAuthStrategy;

  const mockConfigService = {
    get: jest.fn(
      (key: string, defaultValue?: string) =>
        ({
          JWT_SECRET: 'test-secret',
          NODE_ENV: 'test',
          FRONTEND_URL: 'http://localhost:3000',
          COOKIE_DOMAIN: '',
          MIDDLEWARE_URL: 'http://localhost:3001',
          BCSC_AUTHORITY: 'https://bcsc.example.com',
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
  const mockBcscOAuthService = {
    getAuthorizationUrl: jest.fn().mockReturnValue({
      url: 'https://bcsc.example.com/authorize?foo=bar',
      state: validPKCE.state,
    }),
    getPKCEChallengeForStorage: jest.fn().mockReturnValue(validPKCE),
    setPKCEChallenge: jest.fn(),
    exchangeCodeForTokens: jest.fn().mockResolvedValue(mockTokens),
    getUserInfo: jest.fn().mockResolvedValue(mockUserInfo),
  };

  const mockRes = () =>
    ({
      cookie: jest.fn().mockReturnThis(),
      clearCookie: jest.fn().mockReturnThis(),
      redirect: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    }) as unknown as Parameters<typeof strategy.handleGetCallback>[1];

  const validCallbackReq = (overrides = {}) =>
    ({
      query: { code: 'auth-code-123', state: validPKCE.state },
      cookies: {
        oauth_state: validPKCE.state,
        pkce_challenge: JSON.stringify(validPKCE),
      },
      ...overrides,
    }) as unknown as Parameters<typeof strategy.handleGetCallback>[0];

  beforeEach(() => {
    strategy = new BcscOAuthAuthStrategy(
      mockConfigService as unknown as ConfigService,
      mockUserService as unknown as UserService,
      mockAuthService as unknown as AuthService,
      mockBcscOAuthService as unknown as BcscOAuthService,
      mockTokenBlacklistService as unknown as TokenBlacklistService,
      mockUserUtil as unknown as UserUtil,
      mockLogger as unknown as PinoLogger,
    );
    jest
      .spyOn(strategy as any, 'createUserSession')
      .mockResolvedValue(undefined);
  });

  afterEach(() => jest.clearAllMocks());

  describe('handleLogin', () => {
    it('redirects to the BCSC authorization URL', async () => {
      const res = mockRes();

      await strategy.handleLogin(
        { cookies: {} } as unknown as Parameters<
          typeof strategy.handleLogin
        >[0],
        res,
      );

      expect(res.redirect).toHaveBeenCalledWith(
        'https://bcsc.example.com/authorize?foo=bar',
      );
    });

    it('sets oauth_state and pkce_challenge cookies', async () => {
      const res = mockRes();

      await strategy.handleLogin(
        { cookies: {} } as unknown as Parameters<
          typeof strategy.handleLogin
        >[0],
        res,
      );

      expect(res.cookie).toHaveBeenCalledWith(
        'oauth_state',
        validPKCE.state,
        expect.any(Object),
      );
      expect(res.cookie).toHaveBeenCalledWith(
        'pkce_challenge',
        JSON.stringify(validPKCE),
        expect.any(Object),
      );
    });
  });

  describe('handlePostCallback', () => {
    const emptyReq = {} as unknown as Parameters<
      typeof strategy.handlePostCallback
    >[0];

    it('creates a session and returns success JSON', async () => {
      const res = mockRes();

      await strategy.handlePostCallback(emptyReq, res, {
        code: 'auth-code-123',
        redirect_uri: 'http://localhost:3000/auth/callback',
      });

      expect((strategy as any).createUserSession).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true }),
      );
    });

    it('returns 400 when authorization code is missing', async () => {
      const res = mockRes();

      await strategy.handlePostCallback(emptyReq, res, {
        code: '',
        redirect_uri: 'http://localhost:3000/auth/callback',
      });

      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect((strategy as any).createUserSession).not.toHaveBeenCalled();
    });

    it('returns 400 when redirect_uri is missing', async () => {
      const res = mockRes();

      await strategy.handlePostCallback(emptyReq, res, {
        code: 'auth-code-123',
        redirect_uri: '',
      });

      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect((strategy as any).createUserSession).not.toHaveBeenCalled();
    });
  });

  describe('handleGetCallback', () => {
    it('exchanges code, creates session, and redirects to dashboard', async () => {
      const res = mockRes();

      await strategy.handleGetCallback(validCallbackReq(), res);

      expect(mockBcscOAuthService.exchangeCodeForTokens).toHaveBeenCalledWith(
        'auth-code-123',
        validPKCE.state,
      );
      expect(mockBcscOAuthService.getUserInfo).toHaveBeenCalledWith(
        mockTokens.access_token,
      );
      expect((strategy as any).createUserSession).toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/dashboard',
      );
    });

    it('sets the id_token cookie on success', async () => {
      const res = mockRes();

      await strategy.handleGetCallback(validCallbackReq(), res);

      expect(res.cookie).toHaveBeenCalledWith(
        'id_token',
        mockTokens.id_token,
        expect.any(Object),
      );
    });

    it('clears oauth_state and pkce_challenge cookies on success', async () => {
      const res = mockRes();

      await strategy.handleGetCallback(validCallbackReq(), res);

      expect(res.clearCookie).toHaveBeenCalledWith(
        'oauth_state',
        expect.any(Object),
      );
      expect(res.clearCookie).toHaveBeenCalledWith(
        'pkce_challenge',
        expect.any(Object),
      );
    });

    it('redirects with state_mismatch when state does not match', async () => {
      const res = mockRes();

      await strategy.handleGetCallback(
        validCallbackReq({
          query: { code: 'auth-code-123', state: 'wrong-state' },
        }),
        res,
      );

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('state_mismatch'),
      );
      expect((strategy as any).createUserSession).not.toHaveBeenCalled();
    });

    it('redirects with no_code when authorization code is absent', async () => {
      const res = mockRes();

      await strategy.handleGetCallback(
        validCallbackReq({ query: { state: validPKCE.state } }),
        res,
      );

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('no_code'),
      );
    });

    it('redirects with missing_pkce when pkce_challenge cookie is absent', async () => {
      const res = mockRes();

      await strategy.handleGetCallback(
        validCallbackReq({ cookies: { oauth_state: validPKCE.state } }),
        res,
      );

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('missing_pkce'),
      );
    });

    it('redirects with invalid_pkce when pkce_challenge is malformed JSON', async () => {
      const res = mockRes();

      await strategy.handleGetCallback(
        validCallbackReq({
          cookies: {
            oauth_state: validPKCE.state,
            pkce_challenge: '{bad-json',
          },
        }),
        res,
      );

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('invalid_pkce'),
      );
    });
  });

  describe('handlePostCallback', () => {
    it('creates a session and returns success JSON', async () => {
      const res = mockRes();

      await strategy.handlePostCallback(
        {} as unknown as Parameters<typeof strategy.handlePostCallback>[0],
        res,
        {
          code: 'auth-code-123',
          redirect_uri: 'http://localhost:3000/auth/callback',
        },
      );

      expect((strategy as any).createUserSession).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true }),
      );
    });

    it('returns 400 when authorization code is missing', async () => {
      const res = mockRes();

      await strategy.handlePostCallback(
        {} as unknown as Parameters<typeof strategy.handlePostCallback>[0],
        res,
        {
          code: '',
          redirect_uri: 'http://localhost:3000/auth/callback',
        },
      );

      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect((strategy as any).createUserSession).not.toHaveBeenCalled();
    });

    it('returns 400 when redirect_uri is missing', async () => {
      const res = mockRes();

      await strategy.handlePostCallback(
        {} as unknown as Parameters<typeof strategy.handlePostCallback>[0],
        res,
        {
          code: 'auth-code-123',
          redirect_uri: '',
        },
      );

      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect((strategy as any).createUserSession).not.toHaveBeenCalled();
    });
  });

  describe('handleLogout', () => {
    it('blacklists the current token', () => {
      const blacklistSpy = jest.spyOn(strategy as any, 'blacklistCurrentToken');
      const req = { cookies: {} } as unknown as Parameters<
        typeof strategy.handleLogout
      >[0];

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

    it('redirects to the BCSC logout endpoint', () => {
      const res = mockRes();

      strategy.handleLogout({ cookies: { id_token: undefined } } as any, res);

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('bcsc.example.com'),
      );
    });

    it('includes id_token_hint in the logout URL when present', () => {
      const res = mockRes();

      strategy.handleLogout(
        { cookies: { id_token: 'some-id-token' } } as any,
        res,
      );

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('id_token_hint=some-id-token'),
      );
    });

    it('omits id_token_hint when id_token cookie is absent', () => {
      const res = mockRes();

      strategy.handleLogout({ cookies: {} } as any, res);

      expect(res.redirect).toHaveBeenCalledWith(
        expect.not.stringContaining('id_token_hint'),
      );
    });
  });
});
