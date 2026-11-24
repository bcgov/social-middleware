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
      (mockJwt.verify as jest.Mock).mockReturnValue(mockDecoded);

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
      (mockJwt.verify as jest.Mock).mockReturnValue({
        ...mockDecoded,
        exp: undefined,
      });

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

  describe('getUserProfile', () => {
    const req = {} as Request;
    const user = (overrides: Record<string, unknown> = {}) => ({
      first_name: 'Jane',
      last_name: 'Doe',
      street_address: '123 Main St',
      city: 'Victoria',
      region: 'BC',
      postal_code: 'V8V 1A1',
      dateOfBirth: '1990-01-01',
      sex: 'Female',
      email: 'jane@example.com',
      resource_case_id: 'case-001',
      resource_case_active_date: new Date('2025-01-15'),
      resource_case_sub_type: 'FCH',
      resource_case_closed: false,
      non_key_player_caregiver: null,
      ...overrides,
    });
    const flag = (value: string | undefined) =>
      mockConfigService.get.mockImplementation((key: string) =>
        key === 'TEST_RESOURCE_CASE' ? value : 'test-secret',
      );

    beforeEach(() => {
      mockSessionUtil.extractUserIdFromRequest.mockReturnValue('user-001');
      flag('true');
    });
    afterEach(() => mockConfigService.get.mockReturnValue('test-secret'));
    it('sends the case date and sub type for an open case', async () => {
      mockUserService.findOne.mockResolvedValue(user());

      const result = await controller.getUserProfile(req);

      expect(result).toMatchObject({
        resource_case_active_date: new Date('2025-01-15'),
        resource_case_sub_type: 'FCH',
      });
    });
    it('omits case details once the case is closed', async () => {
      mockUserService.findOne.mockResolvedValue(
        user({ resource_case_closed: true, resource_case_sub_type: null }),
      );

      const result = await controller.getUserProfile(req);

      expect(result).not.toHaveProperty('resource_case_active_date');
      expect(result).not.toHaveProperty('resource_case_sub_type');
    });
    it('omits case details when the user has never had a case', async () => {
      mockUserService.findOne.mockResolvedValue(
        user({
          resource_case_id: null,
          resource_case_active_date: null,
          resource_case_sub_type: null,
        }),
      );

      const result = await controller.getUserProfile(req);

      expect(result).not.toHaveProperty('resource_case_active_date');
      expect(result).not.toHaveProperty('resource_case_sub_type');
    });
    it('omits case details when TEST_RESOURCE_CASE is off', async () => {
      flag(undefined);
      mockUserService.findOne.mockResolvedValue(user());

      const result = await controller.getUserProfile(req);

      expect(result).not.toHaveProperty('resource_case_active_date');
      expect(result).not.toHaveProperty('resource_case_sub_type');
      expect(result).not.toHaveProperty('non_key_player_caregiver');
    });
  });
});
