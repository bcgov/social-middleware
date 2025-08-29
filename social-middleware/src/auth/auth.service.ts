// note, still in progress, not yet tested or linted

import { Injectable } from '@nestjs/common';
import axios from 'axios';
import qs from 'qs';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';

// this service is for handling OAuth2 authentication with a code verifier;
// it is used for ICM Siebel Labs Integration

//interface OAuthTokenResponse {
//  access_token: string;
//  expires_in: number;
//  token_type?: string;
//  refresh_token?: string;
//}
@Injectable()
export class AuthService {
  private codeVerifier = '';
  private accessToken: string | null = null;
  private expiresAt = 0;

  constructor(private readonly config: ConfigService) {}

  generateCodeVerifier() {
    this.codeVerifier = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(this.codeVerifier).digest();
    return this.base64URLEncode(hash);
  }

  base64URLEncode(buffer: Buffer) {
    return buffer
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt) {
      return this.accessToken;
    }

    // This part assumes you've received the authorization code (manual step or frontend redirect)
    const code = 'TEMP_AUTH_CODE'; // You'd dynamically get this in a real flow

    const tokenUrl = this.config.get<string>('OAUTH_TOKEN_URL');
    const clientId = this.config.get<string>('OAUTH_CLIENT_ID');
    const clientSecret = this.config.get<string>('OAUTH_CLIENT_SECRET');
    const redirectUri = this.config.get<string>('OAUTH_REDIRECT_URI');

    if (!tokenUrl || !clientId || !redirectUri) {
      throw new Error('Missing OAuth configuration');
    }

    const data = qs.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: this.codeVerifier,
    });

    const response = await axios.post<{
      access_token: string;
      expires_in: number;
      token_type?: string;
      refresh_token?: string;
    }>(tokenUrl, data, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(clientSecret && {
          Authorization:
            'Basic ' +
            Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        }),
      },
    });

    this.accessToken = response.data.access_token;
    this.expiresAt = Date.now() + response.data.expires_in * 1000;
    return this.accessToken;
  }
}
