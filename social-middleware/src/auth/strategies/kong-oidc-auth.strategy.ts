import { Injectable, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { AuthStrategy } from './auth-strategy.interface';
import { BaseAuthStrategy } from './base-auth.strategy';
import { UserService } from '../user.service';
import { AuthService } from '../auth.service';
import { UserUtil } from '../../common/utils/user.util';
import { UserInfo } from '../interfaces/user-info.interface';

@Injectable()
export class KongOidcAuthStrategy
  extends BaseAuthStrategy
  implements AuthStrategy
{
  private readonly middlewareURL: string;

  constructor(
    configService: ConfigService,
    userService: UserService,
    authService: AuthService,
    userUtil: UserUtil,
    logger: PinoLogger,
  ) {
    super(configService, userService, authService, userUtil, logger);
    this.middlewareURL = this.configService
      .get<string>('MIDDLEWARE_URL', 'http://localhost:3001')
      .trim();
    this.logger.setContext(KongOidcAuthStrategy.name);
  }

  async handleLogin(req: Request, res: Response): Promise<void> {
    this.logger.info('Kong OIDC mode - checking X-Userinfo header');

    const userInfoHeader = this.extractUserInfoHeader(req);

    if (!userInfoHeader) {
      this.logger.warn(
        'Kong OIDC mode enabled but no X-Userinfo header received',
      );
      this.redirectWithError(res, 'not_authenticated');
      return;
    }

    this.logger.info('Kong OIDC authenticated user, processing...');
    await this.processKongCallback(req, res);
  }

  /**
   * Handle GET callback in Kong OIDC mode
   * Processes X-Userinfo header from Kong
   */
  async handleGetCallback(req: Request, res: Response): Promise<void> {
    this.logger.info('Kong OIDC GET callback - processing X-Userinfo');

    const userInfoHeader = this.extractUserInfoHeader(req);

    if (!userInfoHeader) {
      this.logger.error('Kong OIDC mode enabled but missing X-Userinfo header');
      this.redirectWithError(res, 'oidc_failed');
      return;
    }

    await this.processKongCallback(req, res);
  }

  /**
   * Handle POST callback in Kong OIDC mode
   * POST callback is not supported - Kong uses GET redirects
   */

  async handlePostCallback(
    req: Request,
    res: Response,
    //body: { code: string; redirect_uri: string },
  ): Promise<void> {
    this.logger.error('POST callback not supported in Kong OIDC mode');
    res.status(HttpStatus.BAD_REQUEST).json({
      error: 'POST callback not supported in Kong OIDC mode. Use GET callback.',
    });

    return Promise.resolve();
  }

  /**
   * Handle logout in Kong OIDC mode
   * Clears session and redirects to Kong's logout endpoint
   */

  handleLogout(req: Request, res: Response): void {
    this.logger.info('Kong OIDC logout - clearing session');

    this.clearSessionCookie(res);

    this.logger.info('Redirecting to Kong OIDC logout endpoint');
    res.redirect(`${this.middlewareURL}/logout`);
  }

  /**
   * Extract and validate X-Userinfo header from request
   */
  private extractUserInfoHeader(req: Request): string | null {
    const header = req.headers['x-userinfo'];

    // Header could be string, string[], or undefined
    if (Array.isArray(header)) {
      this.logger.warn('Received multiple X-Userinfo headers, using first');
      return header[0] || null;
    }

    return header || null;
  }

  /**
   * Process Kong OIDC callback
   * Decodes X-Userinfo header and creates user session
   */

  private async processKongCallback(
    req: Request,
    res: Response,
  ): Promise<void> {
    try {
      const userInfoHeader = this.extractUserInfoHeader(req);

      if (!userInfoHeader) {
        throw new Error('X-Userinfo header missing');
      }

      // Decode base64-encoded user info
      let userInfo: UserInfo;
      try {
        const decoded = Buffer.from(userInfoHeader, 'base64').toString('utf-8');
        const parsed = JSON.parse(decoded);

        // Validate before assigning
        this.validateUserInfo(parsed);
        userInfo = parsed;
      } catch (err) {
        this.logger.error({ err }, 'Failed to decode X-Userinfo header');
        throw new Error('Invalid X-Userinfo header format');
      }

      this.logger.info({ sub: userInfo.sub }, 'OIDC user information decoded');

      // Use shared session creation logic
      //await this.createUserSessionAndRedirect(userInfo, res);
      await this.createUserSession(userInfo, res);
      this.logger.info('Redirecting to frontend callback...');
      res.redirect(`${this.frontendURL}/auth/callback`);
    } catch (err) {
      this.logger.error({ err }, 'Error during Kong OIDC callback processing');
      this.redirectWithError(res, 'auth_processing_failed');
    }
  }
}
