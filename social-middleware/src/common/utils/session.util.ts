import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class SessionUtil {
  private readonly jwtSecret: string;

  constructor(private readonly configService: ConfigService) {
    this.jwtSecret = this.configService.get<string>('JWT_SECRET')!;
  }

  extractUserIdFromRequest(request: Request): string {
    const sessionToken = request.cookies?.app_session as string;
    //const sessionToken = request.cookies?.session as string; //TODO: CONFIRM AFTER LOCAL TESTING

    if (!sessionToken) {
      throw new UnauthorizedException('No session token available.');
    }

    let decoded: jwt.JwtPayload;

    try {
      decoded = jwt.verify(sessionToken, this.jwtSecret) as jwt.JwtPayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired session token');
    }

    const userId = decoded.userId as string;

    if (!userId) {
      throw new UnauthorizedException('UserId not in session token');
    }

    return userId;
  }
}
