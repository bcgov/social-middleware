import { Injectable, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { AuthStrategy } from './auth-strategy.interface';
import { BaseAuthStrategy } from './base-auth.strategy';
import { UserService } from '../user.service';
import { AuthService } from '../auth.service';
import { BcscOAuthService } from '../bcsc-oauth.service';
import { UserUtil } from '../../common/utils/user.util';
import { TokenBlacklistService } from '../services/token-blacklist.service';

@Injectable()
export class BcscOAuthAuthStrategy
  extends BaseAuthStrategy
  implements AuthStrategy
{
  private readonly bcscOAuthService: BcscOAuthService;
  constructor(
    configService: ConfigService,
    userService: UserService,
    authService: AuthService,
    bcscOAuthService: BcscOAuthService,
    tokenBlacklistService: TokenBlacklistService,
    userUtil: UserUtil,
    logger: PinoLogger,
  ) {
    super(
      configService,
      userService,
      authService,
      userUtil,
      logger,
      tokenBlacklistService,
    );
    this.bcscOAuthService = bcscOAuthService;
    this.logger.setContext(BcscOAuthAuthStrategy.name);
  }

  /**
   * Handle login initiation in Direct OAuth mode
   * Redirects to BCSC for authentication
   */

  handleLogin(req: Request, res: Response): Promise<void> {
    this.logger.info('Direct OAuth mode - initiating BCSC OAuth flow');

    const authData = this.bcscOAuthService.getAuthorizationUrl();

    const { url, state } = authData;

    // Store state for CSRF protection
    res.cookie('oauth_state', state, this.getCookieOptions(10 * 60 * 1000));

    // Store PKCE challenge
    const pkceChallenge = this.bcscOAuthService.getPKCEChallengeForStorage();
    res.cookie(
      'pkce_challenge',
      JSON.stringify(pkceChallenge),
      this.getCookieOptions(10 * 60 * 1000),
    );

    this.logger.info({ redirectUrl: url }, 'Redirecting to BCSC');
    res.redirect(url);

    return Promise.resolve();
  }

  /**
   * Handle GET callback in Direct OAuth mode
   * Processes authorization code from BCSC redirect
   */
  async handleGetCallback(req: Request, res: Response): Promise<void> {
    this.logger.info('Direct OAuth GET callback - processing BCSC redirect');

    try {
      const code = this.extractQueryParam(req, 'code');
      const state = this.extractQueryParam(req, 'state');
      const storedState = this.extractCookie(req, 'oauth_state');
      const storedPKCE = this.extractCookie(req, 'pkce_challenge');

      // Validate state (CSRF protection)
      if (!state || !storedState || state !== storedState) {
        this.logger.error('OAuth state mismatch - possible CSRF attack');
        this.redirectWithError(res, 'state_mismatch');
        return;
      }

      if (!code) {
        this.logger.error('No authorization code received');
        this.redirectWithError(res, 'no_code');
        return;
      }

      if (!storedPKCE) {
        this.logger.error('PKCE challenge missing');
        this.redirectWithError(res, 'missing_pkce');
        return;
      }

      // Restore PKCE challenge
      try {
        const parsed: unknown = JSON.parse(storedPKCE);
        if (!this.isValidPKCEChallenge(parsed)) {
          this.logger.error('Invalid PKCE challenge structure');
          this.redirectWithError(res, 'invalid_pkce');
          return;
        }
        this.bcscOAuthService.setPKCEChallenge(parsed);
      } catch (err) {
        this.logger.error({ err }, 'Failed to parse PKCE challenge');
        this.redirectWithError(res, 'invalid_pkce');
        return;
      }

      // Clear OAuth cookies
      res.clearCookie('oauth_state', { path: '/' });
      res.clearCookie('pkce_challenge', { path: '/' });

      this.logger.info('Exchanging code for tokens...');

      const tokens = await this.bcscOAuthService.exchangeCodeForTokens(
        code,
        state,
      );
      const userInfo = await this.bcscOAuthService.getUserInfo(
        tokens.access_token,
      );

      await this.createUserSession(userInfo, res);
      // Store id_token for logout
      this.setIdTokenCookie(res, tokens.id_token);
      this.logger.info('Redirecting to frontend callback...');
      res.redirect(`${this.frontendURL}/dashboard`);
    } catch (err) {
      this.logger.error({ err }, 'Error during OAuth callback');
      this.redirectWithError(res, 'auth_processing_failed');
    }
  }

  /**
   * Handle POST callback in Direct OAuth mode
   * Processes authorization code from frontend request body
   */
  async handlePostCallback(
    req: Request,
    res: Response,
    body: { code: string; redirect_uri: string },
  ): Promise<void> {
    this.logger.info('Direct OAuth POST callback - frontend sent code');

    const { code, redirect_uri } = body;

    if (!code) {
      this.logger.error('No authorization code in request body');
      res
        .status(HttpStatus.BAD_REQUEST)
        .json({ error: 'Authorization code required' });
      return;
    }

    if (!redirect_uri) {
      this.logger.error('No redirect_uri in request  body');
      res
        .status(HttpStatus.BAD_REQUEST)
        .json({ error: 'redirect_uri required' });
      return;
    }

    try {
      // Exchange code for tokens (no PKCE validation for POST)
      const tokens = await this.bcscOAuthService.exchangeCodeForTokens(
        code,
        '',
        redirect_uri,
      );
      const userInfo = await this.bcscOAuthService.getUserInfo(
        tokens.access_token,
      );

      // Use shared session creation logic
      await this.createUserSession(userInfo, res);
      // Store id_token for logout
      this.setIdTokenCookie(res, tokens.id_token);
      // return JSON for POST callback (fronend will handle redirect)
      res.status(HttpStatus.OK).json({
        success: true,
        redirect: `${this.frontendURL}/dashboard`,
      });
    } catch (err) {
      this.logger.error({ err }, 'Error processing POST callback');
      res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .json({ error: 'Authentication failed' });
    }
  }

  /**
   * Handle logout in Direct OAuth mode
   * Clears session and redirects to login page
   */
  handleLogout(req: Request, res: Response): void {
    this.logger.info('Direct OAuth logout - clearing session');

    const idToken = req.cookies.id_token as string;
    this.blacklistCurrentToken(req);
    this.clearSessionCookie(res);

    // Redirect to BCSC logout to clear SSO session
    const bcscAuthority = this.configService.get<string>('BCSC_AUTHORITY');
    const postLogoutRedirectUri = encodeURIComponent(
      `${this.frontendURL}/login`,
    );
    let bcscLogoutUrl = `${bcscAuthority}/protocol/openid-connect/logout?post_logout_redirect_uri=${postLogoutRedirectUri}`;

    // Include id_token_hint if available
    if (idToken) {
      bcscLogoutUrl += `&id_token_hint=${idToken}`;
    }

    this.logger.info('Redirecting to BCSC logout endpoint');
    res.redirect(bcscLogoutUrl);
  }

  /**
   * Safely extract query parameter from request
   * Handles arrays and undefined values
   */
  private extractQueryParam(req: Request, param: string): string | null {
    const value = req.query[param];

    if (value === undefined) {
      return null;
    }

    if (Array.isArray(value)) {
      this.logger.warn(
        { param },
        'Received multiple query parameters, using first',
      );
      const first = value[0];
      return typeof first === 'string' ? first : null;
    }
    // only return if it's actually a string..
    return typeof value === 'string' ? value : null;
  }

  /**
   * Safely extract cookie from request
   */
  private extractCookie(req: Request, cookieName: string): string | null {
    return (req.cookies[cookieName] as string) || null;
  }
  /**
   * Validate PKCE challenge structure
   */
  private isValidPKCEChallenge(obj: any): obj is {
    codeVerifier: string;
    codeChallenge: string;
    state: string;
  } {
    return (
      obj &&
      typeof obj === 'object' &&
      typeof obj.codeVerifier === 'string' &&
      typeof obj.codeChallenge === 'string' &&
      typeof obj.state === 'string'
    );
  }
}
