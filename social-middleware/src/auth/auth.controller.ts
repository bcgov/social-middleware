import {
  Controller,
  Post,
  Get,
  Body,
  Res,
  Req,
  HttpException,
  HttpStatus,
  UseGuards,
  Inject,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { UserService } from './user.service';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiCookieAuth,
} from '@nestjs/swagger';
//import { AuthService } from './auth.service';
//import { BcscOAuthService } from './bcsc-oauth.service';
//import { CreateUserDto } from './dto';
import { PinoLogger } from 'nestjs-pino';
//import { UserUtil } from '../common/utils/user.util';
import { SessionUtil } from '../common/utils/session.util';
import { SessionAuthGuard } from './session-auth.guard';
import { AuthStrategy } from './strategies/auth-strategy.interface';
import { UserProfileResponse } from './interfaces/user-profile-response.interface';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  private readonly jwtSecret: string;
  //private readonly nodeEnv: string;
  //private readonly frontendURL: string;
  //private readonly middlewareURL: string;
  //private readonly cookieDomain: string | undefined;
  //private readonly useKongOidc: boolean;

  constructor(
    private readonly userService: UserService,
    private readonly configService: ConfigService,
    //private readonly authService: AuthService,
    //private readonly bcscOAuthService: BcscOAuthService,
    @Inject('AUTH_STRATEGY') private readonly authStrategy: AuthStrategy,
    private readonly logger: PinoLogger,
    //private readonly userUtil: UserUtil,
    private readonly sessionUtil: SessionUtil,
  ) {
    this.jwtSecret = this.configService.get<string>('JWT_SECRET')!;
    //this.nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
    //this.frontendURL = this.configService.get<string>('FRONTEND_URL')!.trim();
    //this.middlewareURL = this.configService
    //  .get<string>('MIDDLEWARE_URL', 'http://localhost:3001')
    //  .trim();
    //this.cookieDomain =
    //  this.configService.get<string>('COOKIE_DOMAIN') || undefined;
    //this.useKongOidc =
    //  this.configService.get<string>('USE_KONG_OIDC', 'true') === 'true';
    this.logger.setContext(AuthController.name);

    this.logger.info('Auth controller initialized');
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
    return this.authStrategy.handleLogin(req, res);
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
    return this.authStrategy.handleGetCallback(req, res);
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

    return this.authStrategy.handlePostCallback(req, res, body);
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
  @ApiOperation({ summary: 'Clear session and logout' })
  logout(@Req() req: Request, @Res() res: Response): void {
    this.logger.info('========== /auth/logout reached ==========');
    return this.authStrategy.handleLogout(req, res);
  }

  @Get('profile')
  @UseGuards(SessionAuthGuard)
  @ApiOperation({
    summary: 'Get user profile information',
    description:
      'Returns user profile data including name, address, email and phone numbers',
  })
  @ApiCookieAuth('session')
  @ApiResponse({
    status: 200,
    description: 'User profile retrieved successfully',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing session',
  })
  async getUserProfile(@Req() req: Request): Promise<UserProfileResponse> {
    const userId = this.sessionUtil.extractUserIdFromRequest(req);
    const user = await this.userService.findOne(userId);

    return {
      first_name: user.first_name,
      last_name: user.last_name,
      street_address: user.street_address,
      city: user.city,
      region: user.region,
      postal_code: user.postal_code,
      date_of_birth: user.dateOfBirth,
      email: user.email,
      home_phone: user.home_phone,
      alternate_phone: user.alternate_phone,
    };
  }
}

