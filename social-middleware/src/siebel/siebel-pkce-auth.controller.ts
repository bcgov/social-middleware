import { Controller, Get, Query, Res, HttpStatus } from '@nestjs/common';
  import { Response } from 'express';
  import { SiebelPKCEAuthService } from './siebel-pkce-auth.service';
  import { PinoLogger } from 'nestjs-pino';
  import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

  @ApiTags('Siebel PKCE Authentication')
  @Controller('siebel/auth')
  export class SiebelPKCEAuthController {
    constructor(
      private readonly siebelPKCEAuthService: SiebelPKCEAuthService,
      private readonly logger: PinoLogger,
    ) {
      this.logger.setContext(SiebelPKCEAuthController.name);
    }

    @Get('login')
    @ApiOperation({ summary: 'Get Siebel PKCE authentication URL' })
    @ApiResponse({ status: 200, description: 'Returns autheorization URL for manual authentication' })
    async initiateAuth(@Query('redirect') redirect: string) {
      try {
        const authUrl = this.siebelPKCEAuthService.getAuthorizationUrl();
        this.logger.info({ authUrl }, 'Generated Siebel PKCE authentication URL');

        //return res.redirect(authUrl);
        if (redirect === 'true') {
            return { authUrl, redirect: true};
        }

        return {
            authUrl,
            instructions: [
                '1. Copy the authUrl above',
                '2. Open it in your browser and complete authentication',
                '3. Copy the "code" and "state" parameters from the final URL',
                '4. Use the /siebel/auth/callback endpoint with those parameters'
            ]
        };

      } catch (error) {
        //this.logger.error({ error }, 'Failed to initiate Siebel PKCE authentication');
        //return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        //  error: 'Failed to initiate authentication',
        //  message: 'Unable to generate authorization URL',
        //});
        this.logger.error({ error }, 'Failed to generate PKCE authentication');
        throw new Error ('Unable to generate authorization URL');

      }
    }

    @Get('callback')
    @ApiOperation({ summary: 'Handle OAuth callback and exchange code for tokens' })
    @ApiResponse({ status: 200, description: 'Authentication successful' })
    @ApiResponse({ status: 400, description: 'Invalid authorization code or state' })
    async handleCallback(
      @Query('code') code: string,
      @Query('state') state: string,
      @Query('error') error: string | undefined,
      @Query('extract') extract: string | undefined,
      //@Res() res: Response,
    ) {
      if (error) {
        this.logger.error({ error }, 'OAuth authorization error');
        return {
            error: 'Authorization Failed',
            message: error,
        }
      }

      if (!code || !state) {
        this.logger.error('Missing authorization code or state parameter');
        return {
            error: 'Invalid callback',
            message: 'Missing authorization code or state parameter',
        }
      }

      if (extract === 'true') {
        return {
          message: 'Parameters extracted successfully',
          parameters: {
            code,
            state
          },
          instructions: [
            'Use these parameters in Swagger:',
            `code: ${code}`,
            `state: ${state}`,
            'Call this endpoint again without ?extract=true to complete authentication'
          ]
        };
      }

      try {
        const tokens = await this.siebelPKCEAuthService.exchangeCodeForTokens(code, state);

        this.logger.info('Successfully completed Siebel PKCE authentication');

        return {
            message: 'Authentication successful',
            tokenType: tokens.token_type || 'Bearer',
            expiresIn: tokens.expires_in || 3600,
        }

      } catch (error) {
        this.logger.error({ error }, 'Failed to exchange authorization code');
        return {
            error: 'Token exchange failed',
            message: error instanceof Error ? error.message : 'Unknown error',
        }
      }
    }

    @Get('status')
    @ApiOperation({ summary: 'Check Siebel authentication status' })
    @ApiResponse({ status: 200, description: 'Authentication status' })
    async getAuthStatus() {
      const hasValidTokens = this.siebelPKCEAuthService.hasValidTokens();

      return {
        authenticated: hasValidTokens,
        message: hasValidTokens
          ? 'Valid Siebel tokens available'
          : 'No valid Siebel tokens. Please authenticate.',
      };
    }

    @Get('logout')
    @ApiOperation({ summary: 'Clear Siebel authentication tokens' })
    @ApiResponse({ status: 200, description: 'Tokens cleared successfully' })
    async logout() {
      this.siebelPKCEAuthService.clearTokens();
      this.logger.info('Siebel authentication tokens cleared');

      return {
        message: 'Successfully logged out from Siebel',
      };
    }
  }
