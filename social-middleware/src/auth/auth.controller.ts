//AuthController
import { Controller, Post, Get, Body, Res, Req, HttpException, HttpStatus, BadRequestException } from '@nestjs/common';
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
  private readonly BCSC_CLIENT_ID = process.env.BCSC_CLIENT_ID!;
  private readonly BCSC_CLIENT_SECRET = process.env.BCSC_CLIENT_SECRET!;
  private readonly BCSC_AUTHORITY = process.env.BCSC_AUTHORITY!;
  private readonly JWT_SECRET = process.env.JWT_SECRET!;
  private readonly NODE_ENV = process.env.NODE_ENV!;

  constructor(private readonly httpService: HttpService) {}

  @Post('callback')
  async authCallback(@Body() body: AuthCallbackRequest, @Res({ passthrough: true }) res: Response) {
    console.log('Auth callback received:', { body });
    
    try {
      const { code, redirect_uri } = body;
      
      if (!code) {
        console.error('No authorization code provided');
        throw new BadRequestException('Authorization code required');
      }

      if (!redirect_uri) {
        console.error('No redirect uri provided');
        throw new BadRequestException('Redirect uri required');
      }

      console.log('Exchanging code for tokens...');

      // Prepare token exchange request
      const tokenParams = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.BCSC_CLIENT_ID,
        client_secret: this.BCSC_CLIENT_SECRET,
        code: code,
        redirect_uri: redirect_uri,
      });

      // Exchange authorization code for tokens with BC Services Card
      const tokenResponse = await firstValueFrom(
        this.httpService.post(
          `${this.BCSC_AUTHORITY}/protocol/openid-connect/token`,
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
          `${this.BCSC_AUTHORITY}/protocol/openid-connect/userinfo`,
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
        this.JWT_SECRET,
        {
          expiresIn: '24h',
        }
      );

      console.log('Setting cookies...');
      
      // Set HTTP-only cookies using NestJS response
      // TO DO: Offload these to OpenShift config
      res.cookie('session_token', sessionToken, {
        httpOnly: true,
        secure: this.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      });

      console.log('Session token cookie set');

      if (refresh_token) {
        res.cookie('refresh_token', refresh_token, {
          httpOnly: true,
          secure: this.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        });
        console.log('Refresh token cookie set');
      }

      // Store id_token for logout
      if (id_token) {
        res.cookie('id_token', id_token, {
          httpOnly: true,
          secure: this.NODE_ENV === 'production',
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
          details: this.NODE_ENV === 'development' ? error.message : undefined,
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

      const decoded = jwt.verify(sessionToken, this.JWT_SECRET) as JwtPayload;
      
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
      secure: this.NODE_ENV === 'production', 
      sameSite: 'lax' 
    });
    res.clearCookie('id_token', { 
      httpOnly: true, 
      secure: this.NODE_ENV === 'production', 
      sameSite: 'lax' 
    });
    res.clearCookie('refresh_token', { 
      httpOnly: true, 
      secure: this.NODE_ENV === 'production', 
      sameSite: 'lax' 
    });

    if (idToken) {
      const logoutUrl = new URL(`${this.BCSC_AUTHORITY}/protocol/openid-connect/logout`);
      logoutUrl.searchParams.set('id_token_hint', idToken);
      logoutUrl.searchParams.set('post_logout_redirect_uri', 'http://localhost:5173/login');
      logoutUrl.searchParams.set('prompt', 'login');
      return res.redirect(logoutUrl.toString());
    }

    // TO DO: this should not be hardcoded..
    return res.redirect('http://localhost:5173/login');
  }
}