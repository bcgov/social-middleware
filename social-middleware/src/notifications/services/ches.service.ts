import { Injectable, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { firstValueFrom } from 'rxjs';
import { SendEmailDto } from '../dto/send-email.dto';

interface ChesTokenResponse {
  access_token: string;
  expires_in: number;
}

interface ChesMessageResponse {
  txId: string;
  messages: Array<{
    msgId: string;
    to: string[];
  }>;
}

@Injectable()
export class ChesService {
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @InjectPinoLogger(ChesService.name)
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Get CHES access token (cached)
   */
  private async getAccessToken(): Promise<string> {
    const now = Date.now();

    // Return cached token if still valid (with 5 min buffer)
    if (this.accessToken && this.tokenExpiry > now + 5 * 60 * 1000) {
      return this.accessToken;
    }

    this.logger.info('Fetching new CHES access token');

    const tokenUrl = this.configService.get<string>('CHES_TOKEN_URL');
    const clientId = this.configService.get<string>('CHES_CLIENT_ID');
    const clientSecret = this.configService.get<string>('CHES_CLIENT_SECRET');

    // Validate required config
    if (!tokenUrl || !clientId || !clientSecret) {
      throw new Error(
        'Missing CHES configuration: CHES_TOKEN_URL, CHES_CLIENT_ID, and CHES_CLIENT_SECRET are required',
      );
    }

    try {
      const response = await firstValueFrom(
        this.httpService.post<ChesTokenResponse>(
          tokenUrl,
          new URLSearchParams({
            grant_type: 'client_credentials',
          }),
          {
            auth: {
              username: clientId,
              password: clientSecret,
            },
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          },
        ),
      );

      this.accessToken = response.data.access_token;
      this.tokenExpiry = now + response.data.expires_in * 1000;

      this.logger.info('CHES access token obtained');

      return this.accessToken;
    } catch (err) {
      this.logger.error({ err }, 'Failed to get CHES access token');
      const axiosError = err as { response?: { status?: number } };
      throw new HttpException(
        'Failed to authenticate with CHES',
        axiosError.response?.status || 500,
      );
    }
  }

  /**
   * Send email via CHES
   */
  async sendEmail(data: SendEmailDto): Promise<ChesMessageResponse> {
    const token = await this.getAccessToken();
    const chesApiUrl = this.configService.get<string>('CHES_API_URL');

    this.logger.info(
      {
        to: data.to,
        subject: data.subject,
      },
      'Sending email via CHES',
    );

    try {
      const response = await firstValueFrom(
        this.httpService.post<ChesMessageResponse>(
          `${chesApiUrl}/email`,
          {
            bodyType: data.bodyType || 'html',
            body: data.body,
            from: data.from,
            subject: data.subject,
            to: data.to,
            cc: data.cc,
            bcc: data.bcc,
            priority: data.priority || 'normal',
            encoding: 'utf-8',
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      this.logger.info(
        {
          txId: response.data.txId,
          msgId: response.data.messages[0]?.msgId,
        },
        'Email sent successfully via CHES',
      );

      return response.data;
    } catch (err) {
      const errorData =
        err instanceof Error && 'response' in err
          ? (err as { response?: { data?: unknown; status?: number } }).response
          : undefined;

      this.logger.error(
        {
          error:
            errorData?.data ||
            (err instanceof Error ? err.message : 'Unknown error'),
          status: errorData?.status,
        },
        'Failed to send email via CHES',
      );
      throw new HttpException(
        errorData?.data || 'Failed to send email',
        errorData?.status || 500,
      );
    }
  }
}
