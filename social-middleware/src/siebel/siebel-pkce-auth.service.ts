import { Injectable } from '@nestjs/common';
  import { HttpService } from '@nestjs/axios';
  import { ConfigService } from '@nestjs/config';
  import { firstValueFrom } from 'rxjs';
  import { PinoLogger } from 'nestjs-pino';
  import { AxiosResponse, AxiosError } from 'axios';
  import * as crypto from 'crypto';

  interface PKCETokens {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
  }

  interface PKCEChallenge {
    codeVerifier: string;
    codeChallenge: string;
    state: string;
  }

  @Injectable()
  export class SiebelPKCEAuthService {
    private accessToken: string | null = null;
    private refreshToken: string | null = null;
    private tokenExpiry: Date | null = null;
    private pkceChallenge: PKCEChallenge | null = null;

    constructor(
      private readonly httpService: HttpService,
      private readonly configService: ConfigService,
      private readonly logger: PinoLogger,
    ) {
      this.logger.setContext(SiebelPKCEAuthService.name);
    }

    /**
     * Generate PKCE code verifier and challenge
     */
    private generatePKCEChallenge(): PKCEChallenge {
      const codeVerifier = crypto.randomBytes(32).toString('base64url');
      const codeChallenge = crypto
        .createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');
      const state = crypto.randomBytes(16).toString('base64url');

      return {
        codeVerifier,
        codeChallenge,
        state,
      };
    }

    /**
     * Get the authorization URL for PKCE flow
     */
    getAuthorizationUrl(): string {
      this.pkceChallenge = this.generatePKCEChallenge();

      const authUrl = this.configService.get<string>('SIEBEL_AUTH_URL')!;
      const clientId = this.configService.get<string>('SIEBEL_CLIENT_ID')!;
      const redirectUri = this.configService.get<string>('OAUTH_REDIRECT_URI')!;
      const scope = this.configService.get<string>('OAUTH_SCOPE', 'openid data')!;

      const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: scope,
        state: this.pkceChallenge.state,
        code_challenge: this.pkceChallenge.codeChallenge,
        code_challenge_method: 'S256',
        kc_idp_hint: 'gsa',
      });

      return `${authUrl}?${params.toString()}`;
    }

    /**
     * Exchange authorization code for tokens
     */
    async exchangeCodeForTokens(code: string, state: string): Promise<PKCETokens> {
      if (!this.pkceChallenge || this.pkceChallenge.state !== state) {
        throw new Error('Invalid PKCE state parameter');
      }

      try {
        const tokenUrl = this.configService.get<string>('SIEBEL_TOKEN_URL')!;
        const clientId = this.configService.get<string>('SIEBEL_CLIENT_ID')!;
        const redirectUri = this.configService.get<string>('OAUTH_REDIRECT_URI')!;

        const params = new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          code: code,
          redirect_uri: redirectUri,
          code_verifier: this.pkceChallenge.codeVerifier,
        });

        const response: AxiosResponse<PKCETokens> = await firstValueFrom(
          this.httpService.post<PKCETokens>(tokenUrl, params.toString(), {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          }),
        );

        const tokens = response.data;
        this.accessToken = tokens.access_token;
        this.refreshToken = tokens.refresh_token || null;

        const expiresIn = tokens.expires_in || 3600;
        this.tokenExpiry = new Date(Date.now() + (expiresIn - 60) * 1000); // Refresh 1 min before expiry

        this.logger.info('Successfully obtained Siebel PKCE tokens');
        return tokens;
      } catch (error: unknown) {
        let errorData: unknown = null;
        if (error instanceof AxiosError) {
          errorData = error.response?.data;
        }

        this.logger.error({ errorData }, 'Failed to exchange PKCE code for tokens');
        throw new Error('Failed to authenticate with Siebel using PKCE flow');
      }
    }

    /**
     * Refresh the access token using refresh token
     */
    private async refreshAccessToken(): Promise<string> {
      if (!this.refreshToken) {
        throw new Error('No refresh token available for token refresh');
      }

      try {
        const tokenUrl = this.configService.get<string>('SIEBEL_TOKEN_URL')!;
        const clientId = this.configService.get<string>('SIEBEL_CLIENT_ID')!;

        const params = new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: clientId,
          refresh_token: this.refreshToken,
        });

        const response: AxiosResponse<PKCETokens> = await firstValueFrom(
          this.httpService.post<PKCETokens>(tokenUrl, params.toString(), {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          }),
        );

        const tokens = response.data;
        this.accessToken = tokens.access_token;
        if (tokens.refresh_token) {
          this.refreshToken = tokens.refresh_token;
        }

        const expiresIn = tokens.expires_in || 3600;
        this.tokenExpiry = new Date(Date.now() + (expiresIn - 60) * 1000);

        this.logger.info('Successfully refreshed Siebel access token');
        return this.accessToken;
      } catch (error: unknown) {
        let errorData: unknown = null;
        if (error instanceof AxiosError) {
          errorData = error.response?.data;
        }

        this.logger.error({ errorData }, 'Failed to refresh Siebel access token');
        throw new Error('Failed to refresh Siebel access token');
      }
    }

    /**
     * Get a valid access token (refresh if needed)
     */
    async getAccessToken(): Promise<string> {
      // If we don't have a token or it's expired, we need to go through PKCE flow
      if (!this.accessToken || !this.tokenExpiry || new Date() >= this.tokenExpiry) {
        if (this.refreshToken) {
          return this.refreshAccessToken();
        } else {
          throw new Error('No valid access token. Please initiate PKCE authorization flow');
        }
      }

      return this.accessToken;
    }

    /**
     * Check if we have valid tokens
     */
    hasValidTokens(): boolean {
      return !!(this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry);
    }

    /**
     * Clear all tokens and PKCE challenge
     */
    clearTokens(): void {
      this.accessToken = null;
      this.refreshToken = null;
      this.tokenExpiry = null;
      this.pkceChallenge = null;
    }
  }
