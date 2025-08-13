export interface UserPayload {
  sub: string;
  email: string;
  name: string;
  userId?: string;
  iat?: number;
  exp?: number;
}
