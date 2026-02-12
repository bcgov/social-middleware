export interface UserPayload {
  sub: string;
  email: string;
  name: string;
  userId?: string;
  jti?: string;
  iat?: number;
  exp?: number;
}
