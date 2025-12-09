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

  constructor(
    private readonly userService: UserService,
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
    private readonly logger: PinoLogger,
    private readonly userUtil: UserUtil,
  ) {
    this.jwtSecret = this.configService.get<string>('JWT_SECRET')!;
    this.nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
    this.frontendURL = this.configService.get<string>('FRONTEND_URL')!.trim();
    this.middlewareURL = this.configService.get<string>('MIDDLEWARE_URL', 'http://localhost:3001')!.trim();
    this.cookieDomain = this.configService.get<string>('COOKIE_DOMAIN') || undefined;
    this.logger.setContext(AuthController.name);
  }

  /**
   * Login endpoint - Kong OIDC plugin intercepts this request
   * If user is not authenticated, Kong redirects to BCSC OAuth
   * Kong is configured with redirect_uri=/auth/callback, so after OAuth
   * the user will be sent to /auth/callback endpoint
   *
   * This endpoint should NEVER be reached by the middleware - Kong intercepts it
   */
  @Get('login')
  @ApiOperation({ summary: 'Handle login after Kong OIDC authentication' })
  async login(@Req() req: Request, @Res() res: Response) {
    this.logger.info('========== /auth/login reached ==========');

    const userInfoHeader = req.headers['x-userinfo'] as string;

    if (!userInfoHeader) {
      this.logger.warn('No X-Userinfo header - Kong OIDC did not authenticate');
      return res.redirect(`${this.frontendURL}/login?error=not_authenticated`);
    }

    this.logger.info('Kong OIDC authenticated user successfully, processing...');
    return this.handleKongOidcCallback(req, res);
  }

  /**
   * OIDC callback endpoint.
   * Kong OIDC plugin intercepts the OAuth callback, validates state,
   * exchanges code for tokens, and injects X-Userinfo into the request.
   */
  @Get('callback')
  @ApiOperation({
    summary: 'OIDC callback (Kong already authenticated user)',
  })
  @ApiResponse({
    status: 302,
    description: 'User is authenticated and redirected to frontend dashboard',
  })
  async authCallbackGet(@Req() req: Request, @Res() res: Response) {
    this.logger.info('========== /auth/callback reached ==========');
    this.logger.info({ headers: req.headers }, 'Headers from Kong');

    const userInfoHeader = req.headers['x-userinfo'] as string;

    if (!userInfoHeader) {
      this.logger.error('Missing X-Userinfo from Kong OIDC');
      return res.redirect(`${this.frontendURL}/login?error=oidc_failed`);
    }

    return this.handleKongOidcCallback(req, res);
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
   * Logout clears both middleware and Kong OIDC sessions
   * This endpoint clears the middleware session, then redirects to Kong's /logout
   * which will clear the OIDC session and redirect to the login page
   */
  @Get('logout')
  @ApiOperation({ summary: 'Clear session and redirect to Kong OIDC logout' })
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
    this.logger.info('Redirecting to Kong OIDC logout endpoint...');

    // Redirect to Kong's /logout endpoint which will:
    // 1. Revoke OIDC tokens at BCSC
    // 2. Clear Kong's session cookie
    // 3. Redirect to the configured redirect_after_logout_uri (login page)
    return res.redirect(`${this.middlewareURL}/logout`);
  }
}

