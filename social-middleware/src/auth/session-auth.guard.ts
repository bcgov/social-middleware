// src/auth/session-auth.guard.ts

import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import { UserPayload } from '../common/interfaces/user-payload.interface';
import { isValidUserPayload } from '../common/utils';
import { TokenBlacklistService } from './services/token-blacklist.service';

interface AuthenticatedRequest extends Request {
  user?: UserPayload;
}

@Injectable()
export class SessionAuthGuard implements CanActivate {
  private readonly jwtSecret: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly tokenBlacklistService: TokenBlacklistService,
  ) {
    this.jwtSecret = this.configService.get<string>('JWT_SECRET')!;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    try {
      const sessionToken = request.cookies?.app_session as string | undefined;

      if (!sessionToken) {
        return false;
      }

      // Verify JWT token and cast to UserPayload
      const decoded = jwt.verify(sessionToken, this.jwtSecret) as UserPayload;

      // check if the token has been blacklisted
      if (decoded.jti) {
        const isRevoked = await this.tokenBlacklistService.isBlacklisted(
          decoded.jti,
        );
        if (isRevoked) {
          return false;
        }
      }

      // Validate the decoded payload
      if (!isValidUserPayload(decoded)) {
        return false;
      }

      request.user = decoded;

      return true;
    } catch {
      return false;
    }
  }
}
