import {
  isValidUserPayload,
  extractUserId,
  isValidUserPayloadWithUserId,
} from './jwt-validation.util';

const omit = <T extends object, K extends keyof T>(
  obj: T,
  key: K,
): Omit<T, K> => {
  const result = { ...obj };
  delete result[key];
  return result;
};

const validPayload = {
  sub: 'sub-123',
  email: 'test@example.com',
  name: 'Test User',
};

describe('isValidUserPayload', () => {
  it('returns true for a minimal valid payload', () => {
    expect(isValidUserPayload(validPayload)).toBe(true);
  });

  it('returns true with all optional fields present', () => {
    expect(
      isValidUserPayload({
        ...validPayload,
        userId: 'user-123',
        iat: 1000,
        exp: 2000,
      }),
    ).toBe(true);
  });

  it('returns false for null', () => {
    expect(isValidUserPayload(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isValidUserPayload(undefined)).toBe(false);
  });

  it('returns false for a string', () => {
    expect(isValidUserPayload('payload')).toBe(false);
  });

  it('returns false when sub is missing', () => {
    expect(isValidUserPayload(omit(validPayload, 'sub'))).toBe(false);
  });

  it('returns false when email is missing', () => {
    expect(isValidUserPayload(omit(validPayload, 'email'))).toBe(false);
  });

  it('returns false when name is missing', () => {
    expect(isValidUserPayload(omit(validPayload, 'name'))).toBe(false);
  });

  it('returns false when sub is not a string', () => {
    expect(isValidUserPayload({ ...validPayload, sub: 123 })).toBe(false);
  });

  it('returns false when optional userId is not a string', () => {
    expect(isValidUserPayload({ ...validPayload, userId: 123 })).toBe(false);
  });
});

describe('extractUserId', () => {
  it('prefers userId over sub when both are present', () => {
    expect(extractUserId({ ...validPayload, userId: 'mongo-456' })).toBe(
      'mongo-456',
    );
  });

  it('falls back to sub when userId is absent', () => {
    expect(extractUserId(validPayload)).toBe('sub-123');
  });
});

describe('isValidUserPayloadWithUserId', () => {
  it('returns true when payload is valid and userId is a string', () => {
    expect(
      isValidUserPayloadWithUserId({ ...validPayload, userId: 'user-123' }),
    ).toBe(true);
  });

  it('returns false when userId is absent', () => {
    expect(isValidUserPayloadWithUserId(validPayload)).toBe(false);
  });

  it('returns false for an invalid payload', () => {
    expect(isValidUserPayloadWithUserId(null)).toBe(false);
  });
});
