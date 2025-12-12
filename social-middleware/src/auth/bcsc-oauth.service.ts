import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import axios, { AxiosError } from 'axios';
import * as crypto from 'crypto';

interface PKCEChallenge {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
}

interface BCSCTokenResponse {
  access_token: string;
  id_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

interface BCSCUserInfo {
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

@Injectable()
export class BcscOAuthService {
  private pkceChallenge: PKCEChallenge | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(BcscOAuthService.name);
  }

  /**
   * Generate PKCE code verifier and challenge for OAuth flow
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
   * Get the authorization URL for BCSC OAuth flow
   * This generates the URL to redirect users to BCSC login
   */
  getAuthorizationUrl(): { url: string; state: string } {
    this.pkceChallenge = this.generatePKCEChallenge();

    const authority = this.configService.get<string>('BCSC_AUTHORITY')!;
    const clientId = this.configService.get<string>('BCSC_CLIENT_ID')!;
    const middlewareUrl = this.configService.get<string>('MIDDLEWARE_URL')!;
    const redirectUri = `${middlewareUrl}/auth/callback`;

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'openid email profile address',
      state: this.pkceChallenge.state,
      code_challenge: this.pkceChallenge.codeChallenge,
      code_challenge_method: 'S256',
    });

    const authUrl = `${authority}/authorize?${params.toString()}`;

    this.logger.info({ state: this.pkceChallenge.state }, 'Generated BCSC authorization URL');

    return {
      url: authUrl,
      state: this.pkceChallenge.state,
    };
  }

  /**
   * Exchange authorization code for tokens
   *
   * @param code - Authorization code from BCSC
   * @param state - State parameter (optional, only validated if PKCE challenge exists)
   */
  async exchangeCodeForTokens(
    code: string,
    state?: string,
  ): Promise<BCSCTokenResponse> {
    // Only validate state if we have a PKCE challenge (GET callback flow)
    if (this.pkceChallenge) {
      if (state !== this.pkceChallenge.state) {
        this.logger.error({ receivedState: state, expectedState: this.pkceChallenge.state }, 'PKCE state mismatch');
        throw new Error('Invalid PKCE state parameter - possible CSRF attack');
      }
    }

    try {
      const authority = this.configService.get<string>('BCSC_AUTHORITY')!;
      const clientId = this.configService.get<string>('BCSC_CLIENT_ID')!;
      const clientSecret = this.configService.get<string>('BCSC_CLIENT_SECRET')!;
      const middlewareUrl = this.configService.get<string>('MIDDLEWARE_URL')!;
      const redirectUri = `${middlewareUrl}/auth/callback`;
      const tokenUrl = `${authority}/token`;

      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        redirect_uri: redirectUri,
      });

      // Only include code_verifier if we have a PKCE challenge (GET callback flow)
      if (this.pkceChallenge) {
        params.append('code_verifier', this.pkceChallenge.codeVerifier);
      }

      this.logger.info({ tokenUrl, redirectUri }, 'Exchanging authorization code for tokens');

      const response = await axios.post<BCSCTokenResponse>(
        tokenUrl,
        params.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      this.logger.info('Successfully obtained BCSC tokens');

      // Clear PKCE challenge after successful exchange
      this.pkceChallenge = null;

      return response.data;
    } catch (error: unknown) {
      let errorData: unknown = null;
      if (error instanceof AxiosError) {
        errorData = error.response?.data;
      }

      this.logger.error({ errorData }, 'Failed to exchange authorization code for tokens');
      throw new Error('Failed to authenticate with BCSC');
    }
  }

  /**
   * Get user information from BCSC using access token
   */
  async getUserInfo(accessToken: string): Promise<BCSCUserInfo> {
    try {
      const authority = this.configService.get<string>('BCSC_AUTHORITY')!;
      const userInfoUrl = `${authority}/userinfo`;

      this.logger.info({ userInfoUrl }, 'Fetching user info from BCSC');

      const response = await axios.get<BCSCUserInfo>(userInfoUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      this.logger.info({ sub: response.data.sub }, 'Successfully fetched BCSC user info');

      return response.data;
    } catch (error: unknown) {
      let errorData: unknown = null;
      if (error instanceof AxiosError) {
        errorData = error.response?.data;
      }

      this.logger.error({ errorData }, 'Failed to fetch user info from BCSC');
      throw new Error('Failed to fetch user information from BCSC');
    }
  }

  /**
   * Store PKCE challenge for session (for stateless servers)
   * Returns the challenge to be stored in session/cookie
   */
  getPKCEChallengeForStorage(): PKCEChallenge | null {
    return this.pkceChallenge;
  }

  /**
   * Restore PKCE challenge from session (for stateless servers)
   */
  setPKCEChallenge(challenge: PKCEChallenge): void {
    this.pkceChallenge = challenge;
  }
}
