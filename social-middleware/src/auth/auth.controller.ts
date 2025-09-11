// auth/auth.controller.ts
import {
  Controller,
  Post,
  Get,
  Body,
  Res,
  Req,
  HttpException,
  HttpStatus,
  HttpCode,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { CreateUserDto, AuthCallbackDto } from './dto';
import { UserService } from './user.service';
import {
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiCookieAuth,
  ApiHeader,
  ApiTags,
} from '@nestjs/swagger';
import * as jwt from 'jsonwebtoken';
import { isValidUserPayload } from 'src/common/utils';
import { SiebelApiService } from 'src/siebel/siebel-api.service';
//import { SiebelContactResponse } from 'src/siebel/dto/siebel-contact-response.dto';
import { PinoLogger } from 'nestjs-pino';

interface UserInfo {
  sub: string;
  email: string;
  name?: string;
  given_name: string;
  family_name: string;
  gender: string;
  birthdate: string;
}
interface TokenResponse {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  private readonly bcscClientId: string;
  private readonly bcscClientSecret: string;
  private readonly bcscAuthority: string;
  private readonly jwtSecret: string;
  private readonly nodeEnv: string;
  private readonly frontendURL: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly userService: UserService,
    private readonly configService: ConfigService,
    private readonly siebelApiService: SiebelApiService,
    private readonly logger: PinoLogger,
  ) {
    this.bcscClientId = this.configService.get<string>('BCSC_CLIENT_ID')!;
    this.bcscClientSecret =
      this.configService.get<string>('BCSC_CLIENT_SECRET')!;
    this.bcscAuthority = this.configService.get<string>('BCSC_AUTHORITY')!;
    this.jwtSecret = this.configService.get<string>('JWT_SECRET')!;
    this.nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
    this.frontendURL = this.configService.get<string>('FRONTEND_URL')!;
    this.logger.setContext(AuthController.name);
  }

  @Post('callback')
  @HttpCode(201)
  @ApiOperation({ summary: 'Callback from BC Service Card Authentication' })
  @ApiBody({ type: AuthCallbackDto })
  @ApiResponse({
    status: 201,
    description:
      'Authentication successful - user authenticated and session created',
    schema: {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'BC Services Card user ID',
              example:
                'zslhvdrqjawhma7sg6tnymbje41un9hxm7n/zrigclw=@caregiver-registry-6059',
            },
            email: {
              type: 'string',
              format: 'email',
              description: 'User email address',
              example: 'user@example.com',
            },
            name: {
              type: 'string',
              description: 'Full name of the user',
              example: 'John Doe',
            },
            given_name: {
              type: 'string',
              description: 'User first name',
              example: 'John',
            },
            family_name: {
              type: 'string',
              description: 'User last name',
              example: 'Doe',
            },
          },
          required: ['id', 'email', 'name', 'given_name', 'family_name'],
        },
      },
      required: ['user'],
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Bad Request - Missing or invalid authorization code/redirect URI',
    schema: {
      type: 'object',
      properties: {
        error: {
          type: 'string',
          description: 'Error description',
          example: 'Authentication failed',
        },
        details: {
          type: 'string',
          description: 'Detailed error message (development only)',
          example: 'Authorization code required',
        },
      },
    },
  })
  @ApiResponse({
    status: 500,
    description:
      'Internal Server Error - Token exchange or user creation failed',
    schema: {
      type: 'object',
      properties: {
        error: {
          type: 'string',
          example: 'Authentication failed',
        },
        details: {
          type: 'string',
          description: 'Error details (development only)',
        },
      },
    },
  })
  @ApiCookieAuth('session')
  @ApiCookieAuth('refresh_token')
  @ApiCookieAuth('id_token')
  async authCallback(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    body: AuthCallbackDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const { code, redirect_uri } = body;

      if (!code) {
        this.logger.error({ body }, 'No authorization code provided');
        throw new BadRequestException('Authorization code required');
      }

      if (!redirect_uri) {
        this.logger.error({ body }, 'No redirect uri provided');
        throw new BadRequestException('Redirect uri required');
      }

      this.logger.info('Validation passed. Exchanging code for tokens...');

      // Prepare token exchange request
      const tokenParams = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.bcscClientId,
        client_secret: this.bcscClientSecret,
        code: code,
        redirect_uri: redirect_uri,
      });

      // Exchange authorization code for tokens with BC Services Card
      const tokenResponse = await firstValueFrom(
        this.httpService.post(
          `${this.bcscAuthority}/protocol/openid-connect/token`,
          tokenParams,
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'application/json',
            },
          },
        ),
      );

      this.logger.info('Token exchange successful');

      const tokenData = tokenResponse.data as TokenResponse;
      const { access_token, id_token, refresh_token } = tokenData;

      // Get user info from BC Services Card
      this.logger.info('Fetching user info...');
      const userInfoResponse = await firstValueFrom(
        this.httpService.get(
          `${this.bcscAuthority}/protocol/openid-connect/userinfo`,
          {
            headers: {
              Authorization: `Bearer ${access_token}`,
              Accept: 'application/json',
            },
          },
        ),
      );

      //const userInfo: UserInfo = userInfoResponse.data;

      const userInfo = userInfoResponse.data as UserInfo;

      this.logger.debug({ userInfo }, 'Full userInfo response');

      //console.log('User info received:', { sub: userInfo.sub, email: userInfo.email, first: userInfo.given_name, given: userInfo.given_name, last: userInfo.family_name });

      //  Persist user to database
      const userData: CreateUserDto = {
        bc_services_card_id: userInfo.sub,
        first_name: userInfo.given_name,
        last_name: userInfo.family_name,
        dateOfBirth: userInfo.birthdate,
        sex: userInfo.gender,
        email: userInfo.email,
      };

      this.logger.info('Finding or creating user in database...');
      const user = await this.userService.findOrCreate(userData);
      this.logger.info({ id: user.id, email: user.email }, 'User persisted');

      // Update last login
      await this.userService.updateLastLogin(user.id);
      this.logger.info('Last login updated');

      /*
      // Check for contactId on user record
      console.log('No contactId found. Attempting to fetch from Siebel...');
      try {
        const contactQuery = {
          lastName: user.last_name,
          dateOfBirth: user.dateOfBirth,
        };

        const response = (await this.siebelApiService.getCaseContacts(
          contactQuery,
        )) as SiebelContactResponse;
        const icmContact = response.items?.[0];
        if (icmContact?.rowId) {
          console.log('ICM contact found:', icmContact.rowId);

          await this.userService.updateUser(user.id, {
            contactId: icmContact.rowId,
          });

          console.log('User contactId updated');
        } else {
          console.warn('No matching ICM contact found');
        }
      } catch (error) {
        console.error('Error fetching ICM contact:', error);
      }

      */

      // Create session token for portal
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
          expiresIn: '24h',
        },
      );

      this.logger.info('Setting cookies...');

      // Set HTTP-only cookies using NestJS response
      // TO DO: Offload these to OpenShift config
      res.cookie('session', sessionToken, {
        httpOnly: true,
        secure:
          this.nodeEnv === 'production' ||
          this.frontendURL?.startsWith('https://'),
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      });

      this.logger.info('Session token cookie set');

      if (refresh_token) {
        res.cookie('refresh_token', refresh_token, {
          httpOnly: true,
          secure:
            this.nodeEnv === 'production' ||
            this.frontendURL?.startsWith('https://'),
          sameSite: 'lax',
          maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        });
        this.logger.info('Refresh token cookie set');
      }

      // Store id_token for logout
      if (id_token) {
        res.cookie('id_token', id_token, {
          httpOnly: true,
          secure:
            this.nodeEnv === 'production' ||
            this.frontendURL?.startsWith('https://'),
          sameSite: 'lax',
          maxAge: 24 * 60 * 60 * 1000, // 24 hours
        });
        this.logger.info('ID token cookie set');
      }

      // Return safe user data to frontend
      return {
        user: {
          id: userInfo.sub,
          email: userInfo.email,
          name:
            userInfo.name || `${userInfo.given_name} ${userInfo.family_name}`,
          given_name: userInfo.given_name,
          family_name: userInfo.family_name,
        },
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      //const errorStatus = error instanceof Error ? error.response?.status : 'Unknown error';

      this.logger.error(
        { error },
        'Token exchange error during authentication',
      );

      throw new HttpException(
        {
          error: 'Authentication failed',
          details:
            this.nodeEnv === 'development'
              ? errorMessage
              : ' An error occurred during authentication',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('status')
  @ApiOperation({
    summary: 'Get current authentication status',
    description:
      'Validates the session token and returns current user information if authenticated',
  })
  @ApiCookieAuth('session')
  @ApiResponse({
    status: 200,
    description: 'User is authenticated - returns current user information',
    schema: {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'BC Services Card user ID',
              example:
                'zslhvdrqjawhma7sg6tnymbje41un9hxm7n/zrigclw=@caregiver-registry-6059',
            },
            email: {
              type: 'string',
              format: 'email',
              description: 'User email address',
              example: 'user@example.com',
            },
            name: {
              type: 'string',
              description: 'Full name of the user',
              example: 'John Doe',
            },
          },
          required: ['id', 'email', 'name'],
        },
      },
      required: ['user'],
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - No session token provided or invalid session',
    schema: {
      type: 'object',
      properties: {
        error: {
          type: 'string',
          enum: ['Not authenticated', 'Invalid session'],
          description: 'Error message indicating authentication failure',
          example: 'Not authenticated',
        },
      },
      required: ['error'],
    },
  })
  @ApiHeader({
    name: 'Cookie',
    description: 'HTTP cookies containing session',
    required: true,
    schema: {
      type: 'string',
      example: 'session=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    },
  })
  getStatus(@Req() req: Request) {
    try {
      this.logger.debug(
        { cookies: req.cookies },
        'Checking authentication status',
      );

      const sessionToken = req.cookies.session as string;

      if (!sessionToken) {
        throw new HttpException(
          { error: 'Not authenticated' },
          HttpStatus.UNAUTHORIZED,
        );
      }

      const decoded = jwt.verify(sessionToken, this.jwtSecret);

      if (!isValidUserPayload(decoded)) {
        throw new Error('Invalid token payload');
      }

      return {
        user: {
          id: decoded.sub,
          // we DO NOT expose the MongoDB user ID here
          email: decoded.email,
          name: decoded.name,
        },
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const errorName = error instanceof Error ? error.name : 'Unknown';

      this.logger.error(
        { message: errorMessage, name: errorName },
        'Session validation error',
      );

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        { error: 'Invalid session' },
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  @Get('logout')
  @ApiOperation({
    summary: 'Logout user and clear session',
    description:
      'Clears all authentication cookies and redirects to BC Services Card logout or login page',
  })
  @ApiCookieAuth('session')
  @ApiCookieAuth('id_token')
  @ApiCookieAuth('refresh_token')
  @ApiResponse({
    status: 302,
    description:
      'Redirect to BC Services Card logout (if id_token present) or frontend login page',
    headers: {
      Location: {
        description: 'Redirect URL',
        schema: {
          type: 'string',
          oneOf: [
            {
              description: 'BC Services Card logout URL with id_token_hint',
              example:
                'https://bcsc-authority/protocol/openid-connect/logout?id_token_hint=eyJ...&post_logout_redirect_uri=https://localhost:5137/login&prompt=login',
            },
            {
              description: 'Frontend login page (fallback)',
              example: 'https://localhost:5137/login',
            },
          ],
        },
      },
      'Set-Cookie': {
        description: 'Cookies being cleared',
        schema: {
          type: 'array',
          items: {
            type: 'string',
          },
          example: [
            'session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax',
            'id_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax',
            'refresh_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax',
          ],
        },
      },
    },
  })
  @ApiHeader({
    name: 'Cookie',
    description: 'HTTP cookies (session, id_token, refresh_token)',
    required: false,
    schema: {
      type: 'string',
      example: 'session=eyJ...; id_token=eyJ...; refresh_token=eyJ...',
    },
  })
  logout(@Req() req: Request, @Res() res: Response): void {
    const idToken = req.cookies.id_token as string | undefined;

    // Clear all auth cookies
    res.clearCookie('session', {
      httpOnly: true,
      secure:
        this.nodeEnv === 'production' ||
        this.frontendURL?.startsWith('https://'),
      sameSite: 'lax',
    });
    res.clearCookie('id_token', {
      httpOnly: true,
      secure:
        this.nodeEnv === 'production' ||
        this.frontendURL?.startsWith('https://'),
      sameSite: 'lax',
    });
    res.clearCookie('refresh_token', {
      httpOnly: true,
      secure:
        this.nodeEnv === 'production' ||
        this.frontendURL?.startsWith('https://'),
      sameSite: 'lax',
    });

    if (idToken) {
      const logoutUrl = new URL(
        `${this.bcscAuthority}/protocol/openid-connect/logout`,
      );
      logoutUrl.searchParams.set('id_token_hint', idToken);
      logoutUrl.searchParams.set(
        'post_logout_redirect_uri',
        `${this.configService.get<string>('FRONTEND_URL')}/login`,
      );
      logoutUrl.searchParams.set('prompt', 'login');
      return res.redirect(logoutUrl.toString());
    }

    return res.redirect(`${this.frontendURL}/login`);
  }
}
