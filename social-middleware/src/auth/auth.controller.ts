import {
  Controller,
  Post,
  Get,
  Body,
  Res,
  Req,
  HttpException,
  HttpStatus,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { UserService } from './user.service';
import { AuthService } from './auth.service';
import { BcscOAuthService } from './bcsc-oauth.service';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreateUserDto } from './dto';
import { PinoLogger } from 'nestjs-pino';
import { UserUtil } from 'src/common/utils/user.util';

interface UserInfo {
  sub: string;
  email: string;
  name?: string;
  given_name: string;
  family_name: string;
  gender: string;
  birthdate: string;
  address: {
    street_address: string;
    country: string;
    region: string;
    locality: string;
    postal_code: string;
  };
}

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  private readonly jwtSecret: string;
  private readonly nodeEnv: string;
  private readonly frontendURL: string;
  private readonly middlewareURL: string;
  private readonly cookieDomain: string | undefined;
  private readonly useKongOidc: boolean;

  constructor(
    private readonly userService: UserService,
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
    private readonly bcscOAuthService: BcscOAuthService,
    private readonly logger: PinoLogger,
    private readonly userUtil: UserUtil,
  ) {
    this.jwtSecret = this.configService.get<string>('JWT_SECRET')!;
    this.nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
    this.frontendURL = this.configService.get<string>('FRONTEND_URL')!.trim();
    this.middlewareURL = this.configService.get<string>('MIDDLEWARE_URL', 'http://localhost:3001')!.trim();
    this.cookieDomain = this.configService.get<string>('COOKIE_DOMAIN') || undefined;
    this.useKongOidc = this.configService.get<string>('USE_KONG_OIDC', 'true') === 'true';
    this.logger.setContext(AuthController.name);

    this.logger.info({
      useKongOidc: this.useKongOidc,
      nodeEnv: this.nodeEnv,
      frontendURL: this.frontendURL,
      middlewareURL: this.middlewareURL,
    }, 'Auth controller initialized');
  }

  /**
   * Login endpoint
   *
   * Two modes:
   * 1. Kong OIDC mode (USE_KONG_OIDC=true): Kong intercepts and handles OAuth,
   *    then forwards with X-Userinfo header
   * 2. Direct OAuth mode (USE_KONG_OIDC=false): Middleware handles OAuth directly
   */
  @Get('login')
  @ApiOperation({ summary: 'Initiate login or handle Kong OIDC callback' })
  async login(@Req() req: Request, @Res() res: Response) {
    this.logger.info('========== /auth/login reached ==========');

    if (this.useKongOidc) {
      // Kong OIDC mode - expect X-Userinfo header from Kong
      const userInfoHeader = req.headers['x-userinfo'] as string;

      if (!userInfoHeader) {
        this.logger.warn('Kong OIDC mode enabled but no X-Userinfo header received');
        return res.redirect(`${this.frontendURL}/login?error=not_authenticated`);
      }

      this.logger.info('Kong OIDC authenticated user successfully, processing...');
      return this.handleKongOidcCallback(req, res);
    } else {
      // Direct OAuth mode - redirect to BCSC for authentication
      this.logger.info('Direct OAuth mode - initiating BCSC OAuth flow');

      const { url, state } = this.bcscOAuthService.getAuthorizationUrl();

      // Store state in session cookie for CSRF protection
      res.cookie('oauth_state', state, {
        path: '/',
        httpOnly: true,
        secure: this.nodeEnv === 'production' || this.frontendURL.startsWith('https://'),
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000, // 10 minutes
      });

      // Store PKCE challenge in session (needed for code exchange)
      const pkceChallenge = this.bcscOAuthService.getPKCEChallengeForStorage();
      res.cookie('pkce_challenge', JSON.stringify(pkceChallenge), {
        path: '/',
        httpOnly: true,
        secure: this.nodeEnv === 'production' || this.frontendURL.startsWith('https://'),
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000, // 10 minutes
      });

      this.logger.info({ redirectUrl: url }, 'Redirecting to BCSC for authentication');

      return res.redirect(url);
    }
  }

  /**
   * OIDC callback endpoint (GET) - Used by Kong OIDC
   *
   * Two modes:
   * 1. Kong OIDC mode: Kong intercepts, handles OAuth, injects X-Userinfo
   * 2. Direct OAuth mode: BCSC redirects here with code in query params
   */
  @Get('callback')
  @ApiOperation({
    summary: 'OIDC callback endpoint (GET)',
  })
  @ApiResponse({
    status: 302,
    description: 'User is authenticated and redirected to frontend dashboard',
  })
  async authCallbackGet(@Req() req: Request, @Res() res: Response) {
    this.logger.info('========== GET /auth/callback reached ==========');

    if (this.useKongOidc) {
      // Kong OIDC mode
      this.logger.info({ headers: req.headers }, 'Headers from Kong');
      const userInfoHeader = req.headers['x-userinfo'] as string;

      if (!userInfoHeader) {
        this.logger.error('Kong OIDC mode enabled but missing X-Userinfo header');
        return res.redirect(`${this.frontendURL}/login?error=oidc_failed`);
      }

      return this.handleKongOidcCallback(req, res);
    } else {
      // Direct OAuth mode - BCSC redirects with code in query params
      this.logger.info('Direct OAuth GET callback - processing BCSC redirect');

      return this.handleDirectOAuthCallback(req, res);
    }
  }

  /**
   * OIDC callback endpoint (POST) - Used by frontend in direct OAuth mode
   * This matches the main/dev branch API for local development
   */
  @Post('callback')
  @ApiOperation({
    summary: 'OIDC callback endpoint (POST) - for frontend-driven OAuth',
  })
  @ApiResponse({
    status: 201,
    description: 'User is authenticated and session created',
  })
  async authCallbackPost(
    @Body() body: { code: string; redirect_uri: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.logger.info('========== POST /auth/callback reached ==========');

    if (this.useKongOidc) {
      // Kong OIDC mode doesn't use POST callback
      this.logger.error('POST callback not supported in Kong OIDC mode');
      return res.status(400).json({
        error: 'POST callback not supported in Kong OIDC mode. Use GET callback.',
      });
    }

    // Direct OAuth mode - frontend sends code in request body
    this.logger.info('Direct OAuth POST callback - frontend sent authorization code');

    const { code, redirect_uri } = body;

    if (!code) {
      this.logger.error('No authorization code provided in request body');
      return res.status(400).json({ error: 'Authorization code required' });
    }

    // For POST callback, we don't use PKCE cookies since frontend handles the flow
    // Just exchange the code for tokens directly
    try {
      const tokens = await this.bcscOAuthService.exchangeCodeForTokens(code, '');
      const userInfo = await this.bcscOAuthService.getUserInfo(tokens.access_token);

      return this.processUserAndCreateSession(userInfo, res);
    } catch (err) {
      this.logger.error({ err }, 'Error processing POST callback');
      return res.status(500).json({ error: 'Authentication failed' });
    }
  }

  /**
   * Process user after Kong OIDC plugin authentication.
   * Creates user if missing, sets session cookies, redirects to dashboard.
   */
  private async handleKongOidcCallback(req: Request, res: Response) {
    try {
      const userInfoHeader = req.headers['x-userinfo'] as string;
      const userInfo: UserInfo = JSON.parse(
        Buffer.from(userInfoHeader, 'base64').toString('utf-8'),
      );

      this.logger.info({ userInfo }, 'OIDC user information decoded');

      // Prepare DTO for persistence
      const userData: CreateUserDto = {
        bc_services_card_id: userInfo.sub,
        first_name: userInfo.given_name || '(Mononym)',
        last_name: userInfo.family_name,
        dateOfBirth: this.userUtil.icmDateFormat(userInfo.birthdate),
        sex: userInfo.gender,
        gender: this.userUtil.sexToGenderType(userInfo.gender),
        email: userInfo.email,
        street_address: userInfo.address.street_address,
        city: userInfo.address.locality,
        country: userInfo.address.country,
        region: userInfo.address.region,
        postal_code: userInfo.address.postal_code,
      };

      this.logger.info(userData, 'Finding or creating user in database...');
      const user = await this.userService.findOrCreate(userData);
      this.logger.info({ id: user.id, email: user.email }, 'User persisted');

      await this.userService.updateLastLogin(user.id);

      // Emit user logged in event to trigger ICM lookup
      this.logger.info('Emitting user logged in event for ICM lookup...');
      await this.authService.login(user, userData);

      // Create a session token for the portal (Nest-managed)
      const sessionToken = jwt.sign(
        {
          sub: userInfo.sub,
          email: userInfo.email,
          name:
            userInfo.name || `${userInfo.given_name} ${userInfo.family_name}`,
          userId: user.id.toString(),
          iat: Math.floor(Date.now() / 1000),
        },
        this.jwtSecret,
        { 
          expiresIn: '24h'
        },
      );

      // Set session cookie (named app_session to avoid conflict with Kong's session cookie)
      res.cookie('app_session', sessionToken, {
        path: '/',
        httpOnly: true,
        secure:
          this.nodeEnv === 'production' ||
          this.frontendURL?.startsWith('https://'),
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000,  // 24 hours
        domain: this.cookieDomain,
      });

      this.logger.info('App session cookie set — redirecting to dashboard...');

      // Redirect user to frontend dashboard
      return res.redirect(`${this.frontendURL}/dashboard`);
    } catch (err) {
      this.logger.error({ err }, 'Error during OIDC callback processing');
      return res.redirect(
        `${this.frontendURL}/login?error=auth_processing_failed`,
      );
    }
  }

  /**
   * Check authentication status
   * Returns user info if session cookie is valid
   */
  @Get('status')
  @ApiOperation({ summary: 'Check authentication status' })
  @ApiResponse({
    status: 200,
    description: 'User is authenticated',
  })
  @ApiResponse({
    status: 401,
    description: 'User is not authenticated',
  })
  getStatus(@Req() req: Request) {
    try {
      const sessionToken = req.cookies.app_session as string;

      if (!sessionToken) {
        throw new HttpException(
          { error: 'Not authenticated' },
          HttpStatus.UNAUTHORIZED,
        );
      }

      const decoded = jwt.verify(sessionToken, this.jwtSecret) as any;

      return {
        user: {
          id: decoded.sub,
          email: decoded.email,
          name: decoded.name,
        },
      };
    } catch (error) {
      this.logger.error({ error }, 'Session validation error');
      throw new HttpException(
        { error: 'Invalid session' },
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  /**
   * Process user after direct BCSC OAuth authentication (non-Kong mode)
   */
  private async handleDirectOAuthCallback(req: Request, res: Response) {
    try {
      const code = req.query.code as string;
      const state = req.query.state as string;
      const storedState = req.cookies.oauth_state as string;
      const storedPKCE = req.cookies.pkce_challenge as string;

      // Validate state parameter (CSRF protection)
      if (!state || !storedState || state !== storedState) {
        this.logger.error('OAuth state mismatch - possible CSRF attack');
        return res.redirect(`${this.frontendURL}/login?error=state_mismatch`);
      }

      // Validate authorization code
      if (!code) {
        this.logger.error('No authorization code received from BCSC');
        return res.redirect(`${this.frontendURL}/login?error=no_code`);
      }

      // Restore PKCE challenge from cookie
      if (!storedPKCE) {
        this.logger.error('PKCE challenge missing from session');
        return res.redirect(`${this.frontendURL}/login?error=missing_pkce`);
      }

      try {
        const pkceChallenge = JSON.parse(storedPKCE);
        this.bcscOAuthService.setPKCEChallenge(pkceChallenge);
      } catch (err) {
        this.logger.error({ err }, 'Failed to parse PKCE challenge');
        return res.redirect(`${this.frontendURL}/login?error=invalid_pkce`);
      }

      // Clear OAuth cookies
      res.clearCookie('oauth_state', { path: '/' });
      res.clearCookie('pkce_challenge', { path: '/' });

      this.logger.info('Exchanging authorization code for tokens...');

      // Exchange code for tokens
      const tokens = await this.bcscOAuthService.exchangeCodeForTokens(code, state);

      this.logger.info('Fetching user info from BCSC...');

      // Get user info
      const userInfo = await this.bcscOAuthService.getUserInfo(tokens.access_token);

      this.logger.info({ sub: userInfo.sub }, 'BCSC user information retrieved');

      // Prepare DTO for persistence
      const userData: CreateUserDto = {
        bc_services_card_id: userInfo.sub,
        first_name: userInfo.given_name || '(Mononym)',
        last_name: userInfo.family_name,
        dateOfBirth: this.userUtil.icmDateFormat(userInfo.birthdate),
        sex: userInfo.gender,
        gender: this.userUtil.sexToGenderType(userInfo.gender),
        email: userInfo.email,
        street_address: userInfo.address.street_address,
        city: userInfo.address.locality,
        country: userInfo.address.country,
        region: userInfo.address.region,
        postal_code: userInfo.address.postal_code,
      };

      this.logger.info(userData, 'Finding or creating user in database...');
      const user = await this.userService.findOrCreate(userData);
      this.logger.info({ id: user.id, email: user.email }, 'User persisted');

      await this.userService.updateLastLogin(user.id);

      // Emit user logged in event to trigger ICM lookup
      this.logger.info('Emitting user logged in event for ICM lookup...');
      await this.authService.login(user, userData);

      // Create a session token for the portal
      const sessionToken = jwt.sign(
        {
          sub: userInfo.sub,
          email: userInfo.email,
          name: userInfo.name || `${userInfo.given_name} ${userInfo.family_name}`,
          userId: user.id.toString(),
          iat: Math.floor(Date.now() / 1000),
        },
        this.jwtSecret,
        {
          expiresIn: '24h'
        },
      );

      // Set session cookie
      res.cookie('app_session', sessionToken, {
        path: '/',
        httpOnly: true,
        secure:
          this.nodeEnv === 'production' ||
          this.frontendURL?.startsWith('https://'),
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000,  // 24 hours
        domain: this.cookieDomain,
      });

      this.logger.info('Direct OAuth authentication successful, redirecting to dashboard...');

      // Redirect user to frontend dashboard
      return res.redirect(`${this.frontendURL}/dashboard`);
    } catch (err) {
      this.logger.error({ err }, 'Error during direct OAuth callback processing');
      return res.redirect(
        `${this.frontendURL}/login?error=auth_processing_failed`,
      );
    }
  }

  /**
   * Logout clears both middleware and Kong OIDC sessions
   * This endpoint clears the middleware session, then redirects to Kong's /logout
   * which will clear the OIDC session and redirect to the login page
   */
  @Get('logout')
  @ApiOperation({ summary: 'Clear session and logout' })
  logout(@Req() req: Request, @Res() res: Response): void {
    this.logger.info('========== /auth/logout reached ==========');
    this.logger.info('Clearing middleware session cookie...');

    // Clear the middleware's app_session cookie with explicit path
    res.clearCookie('app_session', {
      path: '/',
      httpOnly: true,
      secure:
        this.nodeEnv === 'production' ||
        this.frontendURL.startsWith('https://'),
      sameSite: 'lax',
      domain: this.cookieDomain,
    });

    this.logger.info('Middleware session cookie cleared');

    if (this.useKongOidc) {
      // Kong OIDC mode - redirect to Kong's logout endpoint
      this.logger.info('Redirecting to Kong OIDC logout endpoint...');

      // Redirect to Kong's /logout endpoint which will:
      // 1. Revoke OIDC tokens at BCSC
      // 2. Clear Kong's session cookie
      // 3. Redirect to the configured redirect_after_logout_uri (login page)
      return res.redirect(`${this.middlewareURL}/logout`);
    } else {
      // Direct OAuth mode - just redirect to login page
      this.logger.info('Direct OAuth mode - redirecting to login page');
      return res.redirect(`${this.frontendURL}/login`);
    }
  }
}

