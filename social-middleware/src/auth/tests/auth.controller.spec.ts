import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { AuthController } from '../auth.controller';
import { UserService } from '../user.service';
import { SessionUtil } from '../../common/utils/session.util';
import { Request, Response } from 'express';
import { SessionAuthGuard } from '../session-auth.guard';
import { TokenBlacklistService } from '../services/token-blacklist.service';
import { PinoLogger } from 'nestjs-pino';

jest.mock('jsonwebtoken');
const mockJwt = jwt as jest.Mocked<typeof jwt>;

describe('AuthController', () => {
  let controller: AuthController;

  const mockUserService = { findOne: jest.fn() };
  const mockConfigService = { get: jest.fn().mockReturnValue('test-secret') };
  const mockAuthStrategy = {
    handleLogin: jest.fn(),
    handleGetCallback: jest.fn(),
    handlePostCallback: jest.fn(),
    handleLogout: jest.fn(),
  };
  const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    setContext: jest.fn(),
  };
  const mockSessionUtil = { extractUserIdFromRequest: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: UserService, useValue: mockUserService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: 'AUTH_STRATEGY', useValue: mockAuthStrategy },
        { provide: PinoLogger, useValue: mockLogger },
        { provide: SessionUtil, useValue: mockSessionUtil },
        {
          provide: SessionAuthGuard,
          useValue: { canActivate: jest.fn().mockReturnValue(true) },
        },
        {
          provide: TokenBlacklistService,
          useValue: {
            isBlacklisted: jest.fn().mockResolvedValue(false),
            blacklist: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getStatus', () => {
    const mockDecoded = {
      sub: 'user-sub-123',
      email: 'test@example.com',
      name: 'Test User',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    it('returns user info and expiresAt when session cookie is valid', () => {
      const req = {
        cookies: { app_session: 'valid.jwt.token' },
      } as unknown as Request;
      mockJwt.verify.mockReturnValue(mockDecoded as any);

      const result = controller.getStatus(req);

      expect(result).toEqual({
        user: {
          id: mockDecoded.sub,
          email: mockDecoded.email,
          name: mockDecoded.name,
        },
        expiresAt: mockDecoded.exp * 1000,
      });
    });

    it('returns expiresAt as 0 when exp is undefined', () => {
      const req = {
        cookies: { app_session: 'valid.jwt.token' },
      } as unknown as Request;
      mockJwt.verify.mockReturnValue({ ...mockDecoded, exp: undefined } as any);

      const result = controller.getStatus(req);

      expect(result.expiresAt).toBe(0);
    });

    it('throws 401 when no session cookie is present', () => {
      const req = { cookies: {} } as unknown as Request;

      let thrownError: unknown;
      try {
        controller.getStatus(req);
      } catch (e) {
        thrownError = e;
      }

      expect(thrownError).toBeInstanceOf(HttpException);
      expect((thrownError as HttpException).getStatus()).toBe(
        HttpStatus.UNAUTHORIZED,
      );
    });

    it('throws 401 when JWT verification fails', () => {
      const req = {
        cookies: { app_session: 'valid.jwt.token' },
      } as unknown as Request;
      mockJwt.verify.mockImplementation(() => {
        throw new Error('invalid signature');
      });

      expect(() => controller.getStatus(req)).toThrow(
        new HttpException(
          { error: 'Invalid session' },
          HttpStatus.UNAUTHORIZED,
        ),
      );
    });

    it('throws 401 when JWT is expired', () => {
      const req = {
        cookies: { app_session: 'valid.jwt.token' },
      } as unknown as Request;
      mockJwt.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      expect(() => controller.getStatus(req)).toThrow(HttpException);
    });
  });
});
