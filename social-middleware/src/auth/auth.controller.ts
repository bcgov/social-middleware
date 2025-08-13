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
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { CreateUserDto } from './dto/create-user.dto';
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

interface AuthCallbackRequest {
  code: string;
  redirect_uri: string;
}

interface UserInfo {
  sub: string;
  email: string;
  name?: string;
  given_name: string;
  family_name: string;
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
  ) {
    this.bcscClientId = this.configService.get<string>('BCSC_CLIENT_ID')!;
    this.bcscClientSecret =
      this.configService.get<string>('BCSC_CLIENT_SECRET')!;
    this.bcscAuthority = this.configService.get<string>('BCSC_AUTHORITY')!;
    this.jwtSecret = this.configService.get<string>('JWT_SECRET')!;
    this.nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
    this.frontendURL = this.configService.get<string>('FRONTEND_URL')!;
  }

  @Post('callback')
  @HttpCode(201)
  @ApiOperation({ summary: 'Callback from BC Service Card Authentication' })
  @ApiBody({
    description: 'Authorization callback data from BC Services Card',
    examples: {
      'successful-callback': {
        summary: 'Successful authorization callback',
        value: {
          code: 'd46c0743-7d28-48f8-a473-394b841c4f35.2ef8f2e8-81a8-48fe-9cb4-67b1da21eec5.c021513a-2b05-4f77-a418-afbd88be4ec0',
          redirect_uri: 'https://portal-url/auth/callback',
        },
      },
    },
  })
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
  @ApiCookieAuth('session_token')
  @ApiCookieAuth('refresh_token')
  @ApiCookieAuth('id_token')
  async authCallback(
    @Body() body: AuthCallbackRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    //console.log('=== AUTH CALLBACK DEBUG ===');
    //console.log('Raw body:', JSON.stringify(body, null, 2));
    //console.log('Body type:', typeof body);
    //console.log('Code:', body.code);
    //console.log('Redirect URI:', body.redirect_uri);
    //console.log('Code exists:', !!body.code);
    //console.log('Redirect URI exists:', !!body.redirect_uri);

    try {
      const { code, redirect_uri } = body;

      if (!code) {
        console.error('No authorization code provided');
        console.error('Body was:', body);
        throw new BadRequestException('Authorization code required');
      }

      if (!redirect_uri) {
        console.error('No redirect uri provided');
        console.error('Body was:', body);
        throw new BadRequestException('Redirect uri required');
      }

      console.log('Validation passed.. Exchanging code for tokens...');

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

      console.log('Token exchange successful');

      const tokenData = tokenResponse.data as TokenResponse;
      const { access_token, id_token, refresh_token } = tokenData;

      // Get user info from BC Services Card
      console.log('Fetching user info...');
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

      console.log(
        'Full userInfo response: ',
        JSON.stringify(userInfoResponse.data, null, 2),
      );
      //console.log('User info received:', { sub: userInfo.sub, email: userInfo.email, first: userInfo.given_name, given: userInfo.given_name, last: userInfo.family_name });

      //  Persist user to database
      const userData: CreateUserDto = {
        bc_services_card_id: userInfo.sub,
        first_name: userInfo.given_name,
        last_name: userInfo.family_name,
        dateOfBirth: userInfo.birthdate,
        email: userInfo.email,
      };

      console.log('Finding or creating user in database...');
      const user = await this.userService.findOrCreate(userData);
      console.log('User persisted:', { id: user.id, email: user.email });

      // Update last login
      await this.userService.updateLastLogin(user.id);
      console.log('Last login updated');

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

      console.log('Setting cookies...');

      // Set HTTP-only cookies using NestJS response
      // TO DO: Offload these to OpenShift config
      res.cookie('session_token', sessionToken, {
        httpOnly: true,
        secure:
          this.nodeEnv === 'production' ||
          this.frontendURL?.startsWith('https://'),
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      });

      console.log('Session token cookie set');

      if (refresh_token) {
        res.cookie('refresh_token', refresh_token, {
          httpOnly: true,
          secure:
            this.nodeEnv === 'production' ||
            this.frontendURL?.startsWith('https://'),
          sameSite: 'lax',
          maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        });
        console.log('Refresh token cookie set');
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
        console.log('ID token cookie set');
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

      console.error('Token exchange error:', {
        message: errorMessage,
        //response: error.response?.data,
        //status: error.response?.status,
        //config: error.config
        //  ? {
        //      url: error.config.url,
        //      method: error.config.method,
        //      headers: error.config.headers,
        //    }
        //  : undefined,
      });

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
  @ApiCookieAuth('session_token')
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
    description: 'HTTP cookies containing session_token',
    required: true,
    schema: {
      type: 'string',
      example: 'session_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    },
  })
  getStatus(@Req() req: Request) {
    try {
      console.log('All cookies:', req.cookies);

      const sessionToken = req.cookies.session_token as string;

      console.log('Session token:', sessionToken ? 'Present' : 'Missing');

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

      console.error('Session validation error:', {
        message: errorMessage,
        name: errorName,
      });

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
  @ApiCookieAuth('session_token')
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
            'session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax',
            'id_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax',
            'refresh_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax',
          ],
        },
      },
    },
  })
  @ApiHeader({
    name: 'Cookie',
    description: 'HTTP cookies (session_token, id_token, refresh_token)',
    required: false,
    schema: {
      type: 'string',
      example: 'session_token=eyJ...; id_token=eyJ...; refresh_token=eyJ...',
    },
  })
  logout(@Req() req: Request, @Res() res: Response): void {
    const idToken = req.cookies.id_token as string | undefined;

    // Clear all auth cookies
    res.clearCookie('session_token', {
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
