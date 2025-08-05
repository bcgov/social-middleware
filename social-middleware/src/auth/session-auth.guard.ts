// src/auth/session-auth.guard.ts

import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  private readonly jwtSecret: string;
  constructor(private readonly configService: ConfigService) {
    this.jwtSecret = this.configService.get<string>('JWT_SECRET')!;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    try {
      const sessionToken = request.cookies?.session_token;

      if (!sessionToken) {
        return false;
      }

      // Verify JWT token
      const decoded = jwt.verify(sessionToken, this.jwtSecret);

      request.user = decoded;
      return true;
    } catch (error) {
      return false;
    }
  }
}
