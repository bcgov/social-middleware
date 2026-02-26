import { ConfigService } from '@nestjs/config';
import { Response, Request } from 'express';
import { PinoLogger } from 'nestjs-pino';
import * as jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { UserService } from '../user.service';
import { AuthService } from '../auth.service';
import { UserUtil } from '../../common/utils/user.util';
import { CreateUserDto } from '../dto';
import { UserInfo } from '../interfaces/user-info.interface';
import { User } from '../schemas/user.schema';
import { TokenBlacklistService } from '../services/token-blacklist.service';
import { UserPayload } from '../../common/interfaces';

export abstract class BaseAuthStrategy {
  protected readonly jwtSecret: string;
  protected readonly nodeEnv: string;
  protected readonly frontendURL: string;
  protected readonly cookieDomain: string | undefined;
  private readonly allowedFrontendUrls: string[];

  constructor(
    protected readonly configService: ConfigService,
    protected readonly userService: UserService,
    protected readonly authService: AuthService,
    protected readonly userUtil: UserUtil,
    protected readonly logger: PinoLogger,
    protected readonly tokenBlacklistService: TokenBlacklistService,
  ) {
    this.jwtSecret = this.configService.get<string>('JWT_SECRET')!;
    this.nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
    this.frontendURL = this.configService.get<string>('FRONTEND_URL')!.trim();
    this.cookieDomain =
      this.configService.get<string>('COOKIE_DOMAIN') || undefined;

    // Validate frontend URL format
    this.allowedFrontendUrls = [this.frontendURL];
    this.validateFrontendUrl(this.frontendURL);
  }

  /**
   * Validate that the frontend URL is safe (no open redirect vulnerability)
   */
  private validateFrontendUrl(url: string): void {
    try {
      const parsed = new URL(url);
      // Ensure it's http or https
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(`Invalid frontend URL protocol: ${parsed.protocol}`);
      }
    } catch (err) {
      this.logger.error({ url, err }, 'Invalid FRONTEND_URL configuration');
      throw new Error('Invalid FRONTEND_URL configuration');
    }
  }

  /**
   * Validate user info from OIDC provider
   * Ensures all required fields are present before processing
   */
  protected validateUserInfo(userInfo: any): asserts userInfo is UserInfo {
    const requiredFields = [
      'sub',
      'email',
      'given_names',
      'family_name',
      'birthdate',
    ];

    for (const field of requiredFields) {
      if (!userInfo[field]) {
        throw new Error(`Invalid user info: missing required field '${field}'`);
      }
    }

    // Validate address object
    if (
      !userInfo.address ||
      typeof userInfo.address !== 'object' ||
      !userInfo.address.street_address ||
      !userInfo.address.locality ||
      !userInfo.address.region ||
      !userInfo.address.postal_code ||
      !userInfo.address.country
    ) {
      throw new Error('Invalid user info: incomplete address information');
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(userInfo.email)) {
      throw new Error('Invalid user info: invalid email format');
    }
  }

  /**
   * Create user session (without redirect)
   * Returns user info for custom response handling
   */
  protected async createUserSession(
    userInfo: UserInfo,
    res: Response,
  ): Promise<void> {
    // Validate user info before processing
    this.validateUserInfo(userInfo);

    const userData: CreateUserDto = {
      bc_services_card_id: userInfo.sub,
      first_name: userInfo.given_names || '(Mononym)',
      last_name: userInfo.family_name,
      dateOfBirth: this.userUtil.icmDateFormat(userInfo.birthdate),
      //sex: userInfo.gender || '',
      email: userInfo.email,
      street_address: userInfo.address.street_address,
      city: userInfo.address.locality,
      country: userInfo.address.country,
      region: userInfo.address.region,
      postal_code: userInfo.address.postal_code,
    };

    this.logger.info('Finding or creating user...');
    const user = await this.userService.findOrCreate(userData);
    this.logger.info({ id: user.id, email: user.email }, 'User persisted');

    await this.userService.updateLastLogin(user.id);
    await this.authService.login(user, userData);

    const sessionToken = this.createSessionToken(userInfo, user);
    this.setSessionCookie(res, sessionToken);

    this.logger.info('Session created...');
  }

  /**
   * Create user session and redirect to dashboard
   * Used by GET callback flows (Kong OIDC and Direct OAuth GET)
   */
  protected async createUserSessionAndRedirect(
    userInfo: UserInfo,
    res: Response,
  ): Promise<void> {
    await this.createUserSession(userInfo, res);

    this.logger.info('Redirecting to dashboard...');
    res.redirect(`${this.frontendURL}/dashboard`);
  }

  /**
   * Create JWT session token
   */
  protected createSessionToken(userInfo: UserInfo, user: User): string {
    return jwt.sign(
      {
        sub: userInfo.sub,
        email: userInfo.email,
        name:
          userInfo.name || `${userInfo.given_names} ${userInfo.family_name}`,
        userId: user.id.toString(),
        jti: uuidv4(),
        iat: Math.floor(Date.now() / 1000),
      },
      this.jwtSecret,
      { expiresIn: '4h' },
    );
  }

  /**
   * Set session cookie with secure configuration
   */
  protected setSessionCookie(res: Response, token: string): void {
    res.cookie(
      'app_session',
      token,
      this.getCookieOptions(24 * 60 * 60 * 1000),
    );
  }

  /**
   * Set id_token cookie for logout
   */
  protected setIdTokenCookie(res: Response, idToken: string): void {
    res.cookie('id_token', idToken, this.getCookieOptions(24 * 60 * 60 * 1000));
  }

  /**
   * Clear session cookie
   */
  protected clearSessionCookie(res: Response): void {
    const clearOptions = {
      path: '/',
      httpOnly: true,
      secure:
        this.nodeEnv === 'production' ||
        this.frontendURL.startsWith('https://'),
      sameSite: 'strict' as const, // Must match the set cookie options
      ...(this.cookieDomain && { domain: this.cookieDomain }),
    };
    this.logger.info(
      {
        cookieDomain: this.cookieDomain,
        secure: clearOptions.secure,
        sameSite: clearOptions.sameSite,
      },
      'Clearing app_session cookie',
    );

    res.clearCookie('app_session', clearOptions);
    res.clearCookie('id_token', clearOptions);
  }

  /**
   * Get standardized cookie options
   */
  protected getCookieOptions(maxAge?: number) {
    return {
      path: '/',
      httpOnly: true,
      secure:
        this.nodeEnv === 'production' ||
        this.frontendURL.startsWith('https://'),
      sameSite: 'strict' as const,
      ...(maxAge && { maxAge }),
      ...(this.cookieDomain && { domain: this.cookieDomain }),
    };
  }

  /**
   * Blacklist the current token so it cannot be reused
   */
  protected blacklistCurrentToken(req: Request): void {
    const token = req.cookies?.app_session as string;
    if (token) {
      try {
        const decoded = jwt.verify(token, this.jwtSecret) as UserPayload;
        if (decoded.jti && decoded.exp) {
          const remainingSeconds = decoded.exp - Math.floor(Date.now() / 1000);
          if (remainingSeconds > 0) {
            void this.tokenBlacklistService.blacklist(
              decoded.jti,
              remainingSeconds,
            );
          }
        }
      } catch {
        // token already expired of invalid - no need to blacklist
      }
    }
  }

  /**
   * Redirect to frontend with error parameter
   * Centralized error redirect handling
   */
  protected redirectWithError(res: Response, errorCode: string): void {
    this.logger.error({ errorCode }, 'Redirecting to frontend with error');
    res.redirect(`${this.frontendURL}/login?error=${errorCode}`);
  }
}
