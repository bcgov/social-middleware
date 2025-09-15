import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AxiosResponse, AxiosError } from 'axios';

@Injectable()
export class SiebelAuthService {
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  private readonly logger = new Logger(SiebelAuthService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return this.accessToken;
    }

    return await this.refreshToken();
  }

  private async refreshToken(): Promise<string> {
    try {
      const tokenUrl = this.configService.get<string>('SIEBEL_TOKEN_URL')!;
      const clientId = this.configService.get<string>('SIEBEL_CLIENT_ID')!;
      const clientSecret = this.configService.get<string>(
        'SIEBEL_CLIENT_SECRET',
      );

      const params = new URLSearchParams();
      params.append('grant_type', 'client_credentials');
      params.append('client_id', clientId);

      if (clientSecret && clientSecret !== 'None') {
        params.append('client_secret', clientSecret);
      }

      interface TokenResponse {
        access_token: string;
        expires_in?: number;
      }

      const response: AxiosResponse<TokenResponse> = await firstValueFrom(
        this.httpService.post<TokenResponse>(tokenUrl, params.toString(), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }),
      );

      this.accessToken = response.data.access_token;
      const expiresIn = response.data.expires_in || 3600;
      this.tokenExpiry = new Date(Date.now() + (expiresIn - 60) * 1000); // Refresh 1 min before expiry

      this.logger.log('Successfully obtained Siebel access token');
      return this.accessToken;
    } catch (error: unknown) {
      let errorData: unknown = null;
      if (error instanceof AxiosError) {
        errorData = error.response?.data;
      }

      this.logger.error({ errorData }, 'Failed to obtain Siebel access token');

      throw new Error('Failed to authenticate with Siebel');
    }
  }
}
