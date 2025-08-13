import { UserPayload } from '../interfaces/user-payload.interface';

// Type guard to validate if a decoded JWT payload is a valid UserPayload
// @param payload - The decoded JWT payload
// @returns boolean - True if the payload is valid UserPayload

export function isValidUserPayload(payload: unknown): payload is UserPayload {
  if (!payload || typeof payload !== 'object' || payload === null) {
    return false;
  }

  const obj = payload as Record<string, unknown>;

  // Validate required fields
  return (
    typeof obj.sub === 'string' &&
    typeof obj.email === 'string' &&
    typeof obj.name === 'string' &&
    // Optional fields validation
    (obj.userId === undefined || typeof obj.userId === 'string') &&
    (obj.iat === undefined || typeof obj.iat === 'number') &&
    (obj.exp === undefined || typeof obj.exp === 'number')
  );
}

export function extractUserId(payload: UserPayload): string {
  // Prefer userId (MongoDB ID) over sub (BC Services Card ID) for internal operations
  return payload.userId || payload.sub;
}

export function isValidUserPayloadWithUserId(
  payload: unknown,
): payload is UserPayload & { userId: string } {
  return isValidUserPayload(payload) && typeof payload.userId === 'string';
}
