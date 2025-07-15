//AuthController
import { Controller, Post, Get, Body, Res, Req, HttpException, HttpStatus, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as jwt from 'jsonwebtoken';

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
}

interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  iat: number;
}

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
    private readonly configService: ConfigService
  ) {
      this.bcscClientId = this.configService.get<string>('BCSC_CLIENT_ID')!;
      this.bcscClientSecret = this.configService.get<string>('BCSC_CLIENT_SECRET')!;
      this.bcscAuthority = this.configService.get<string>('BCSC_AUTHORITY')!;
      this.jwtSecret = this.configService.get<string>('JWT_SECRET')!;
      this.nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
      this.frontendURL = this.configService.get<string>('FRONTEND_URL')!;
  }

  @Post('callback')
  async authCallback(@Body() body: AuthCallbackRequest, @Res({ passthrough: true }) res: Response) {
    console.log('=== AUTH CALLBACK DEBUG ===');
    console.log('Raw body:', JSON.stringify(body, null, 2));
    console.log('Body type:', typeof body);
    console.log('Code:', body.code);
    console.log('Redirect URI:', body.redirect_uri);
    console.log('Code exists:', !!body.code);
    console.log('Redirect URI exists:', !!body.redirect_uri);
    
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
              'Accept': 'application/json',
            },
          }
        )
      );

      console.log('Token exchange successful');
      const { access_token, id_token, refresh_token } = tokenResponse.data;

      // Get user info from BC Services Card
      console.log('Fetching user info...');
      const userInfoResponse = await firstValueFrom(
        this.httpService.get(
          `${this.bcscAuthority}/protocol/openid-connect/userinfo`,
          {
            headers: {
              Authorization: `Bearer ${access_token}`,
              'Accept': 'application/json',
            },
          }
        )
      );

      const userInfo: UserInfo = userInfoResponse.data;
      console.log('User info received:', { sub: userInfo.sub, email: userInfo.email });

      // Create session token for portal
      const sessionToken = jwt.sign(
        {
          sub: userInfo.sub,
          email: userInfo.email,
          name: userInfo.name || `${userInfo.given_name} ${userInfo.family_name}`,
          iat: Math.floor(Date.now() / 1000),
        },
        this.jwtSecret,
        {
          expiresIn: '24h',
        }
      );

      console.log('Setting cookies...');
      
      // Set HTTP-only cookies using NestJS response
      // TO DO: Offload these to OpenShift config
      res.cookie('session_token', sessionToken, {
        httpOnly: true,
        secure: this.nodeEnv === 'production' || this.frontendURL?.startsWith("https://"),
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      });

      console.log('Session token cookie set');

      if (refresh_token) {
        res.cookie('refresh_token', refresh_token, {
          httpOnly: true,
          secure: this.nodeEnv === 'production' || this.frontendURL?.startsWith("https://"),
          sameSite: 'lax',
          maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        });
        console.log('Refresh token cookie set');
      }

      // Store id_token for logout
      if (id_token) {
        res.cookie('id_token', id_token, {
          httpOnly: true,
          secure: this.nodeEnv === 'production' || this.frontendURL?.startsWith("https://"),
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
          name: userInfo.name || `${userInfo.given_name} ${userInfo.family_name}`,
          given_name: userInfo.given_name,
          family_name: userInfo.family_name,
        },
      };

    } catch (error: any) {
      console.error('Token exchange error:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        config: error.config ? {
          url: error.config.url,
          method: error.config.method,
          headers: error.config.headers,
        } : undefined,
      });

      throw new HttpException(
        {
          error: 'Authentication failed',
          details: this.nodeEnv === 'development' ? error.message : undefined,
        },
        HttpStatus.BAD_REQUEST
      );
    }
  }

  @Get('status')
  async getStatus(@Req() req: Request) {
    try {
      console.log('All cookies:', req.cookies);
      console.log('Headers:', req.headers.cookie);
      
      const sessionToken = req.cookies.session_token;
      console.log('Session token:', sessionToken ? 'Present' : 'Missing');
      
      if (!sessionToken) {
        throw new HttpException({ error: 'Not authenticated' }, HttpStatus.UNAUTHORIZED);
      }

      const decoded = jwt.verify(sessionToken, this.jwtSecret) as JwtPayload;
      
      return {
        user: {
          id: decoded.sub,
          email: decoded.email,
          name: decoded.name,
        },
      };
    } catch (error: any) {
      console.error('Session validation error:', {
        message: error.message,
        name: error.name,
      });
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException({ error: 'Invalid session' }, HttpStatus.UNAUTHORIZED);
    }
  }

  @Get('logout')
  async logout(@Req() req: Request, @Res() res: Response) {
    const idToken = req.cookies.id_token;
    
    // Clear all auth cookies
    res.clearCookie('session_token', { 
      httpOnly: true, 
      secure: this.nodeEnv === 'production' || this.frontendURL?.startsWith("https://"), 
      sameSite: 'lax' 
    });
    res.clearCookie('id_token', { 
      httpOnly: true, 
      secure: this.nodeEnv === 'production' || this.frontendURL?.startsWith("https://"),
      sameSite: 'lax' 
    });
    res.clearCookie('refresh_token', { 
      httpOnly: true, 
      secure: this.nodeEnv === 'production'  || this.frontendURL?.startsWith("https://"),
      sameSite: 'lax' 
    });

    if (idToken) {
      const logoutUrl = new URL(`${this.bcscAuthority}/protocol/openid-connect/logout`);
      logoutUrl.searchParams.set('id_token_hint', idToken);
      logoutUrl.searchParams.set('post_logout_redirect_uri', `${this.configService.get('FRONTEND_URL')}/login`);
      logoutUrl.searchParams.set('prompt', 'login');
      return res.redirect(logoutUrl.toString());
    }

    return res.redirect(`${this.frontendURL}/login`);
  }
}