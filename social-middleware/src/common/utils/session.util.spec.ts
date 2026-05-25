import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { SessionUtil } from './session.util';
import { Request } from 'express';

const TEST_SECRET = 'test-jwt-secret';

describe('SessionUtil - extractUserIdFromRequest', () => {
  let util: SessionUtil;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionUtil,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(TEST_SECRET) },
        },
      ],
    }).compile();

    util = module.get<SessionUtil>(SessionUtil);
  });

  it('throws UnauthorizedException when no session cookie is present', () => {
    const req = { cookies: {} } as unknown as Request;
    expect(() => util.extractUserIdFromRequest(req)).toThrow(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException when cookies is undefined', () => {
    const req = { cookies: undefined } as unknown as Request;
    expect(() => util.extractUserIdFromRequest(req)).toThrow(
      UnauthorizedException,
    );
  });

  it('returns the userId from a valid session token', () => {
    const token = jwt.sign({ userId: 'user-123' }, TEST_SECRET);
    const req = { cookies: { app_session: token } } as unknown as Request;
    expect(util.extractUserIdFromRequest(req)).toBe('user-123');
  });

  it('throws UnauthorizedException when the token has no userId claim', () => {
    const token = jwt.sign({ sub: 'bcsc-123' }, TEST_SECRET);
    const req = { cookies: { app_session: token } } as unknown as Request;
    expect(() => util.extractUserIdFromRequest(req)).toThrow(
      UnauthorizedException,
    );
  });

  it('throws when the token is signed with the wrong secret', () => {
    const token = jwt.sign({ userId: 'user-123' }, 'wrong-secret');
    const req = { cookies: { app_session: token } } as unknown as Request;
    expect(() => util.extractUserIdFromRequest(req)).toThrow();
  });
});
