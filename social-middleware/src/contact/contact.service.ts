import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import axios, { AxiosError } from 'axios';

@Injectable()
export class ContactService {
  private readonly baseUrl =
    'https://sieblabp.apps.gov.bc.ca/dev/v1.0/data/ICMContact/ICMContact';

  // Replace this with dynamic OAuth token retrieval if needed
  private async getAccessToken(): Promise<string> {
    // In production, use refresh token or client credentials flow
    return 'YOUR_ACCESS_TOKEN_HERE';
  }

  async getContactByBirthDate(birthDate: string): Promise<any> {
    const accessToken = await this.getAccessToken();

    try {
      const response = await axios.get(this.baseUrl, {
        params: {
          'Birth Date': birthDate,
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: '*/*',
          'X-ICM-TrustedUsername': 'ICMANON',
        },
      });

      return response.data;
    } catch (error) {
      if (error instanceof AxiosError) {
        const status =
          error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR;
        const message = error.response?.data || 'Failed to retrieve contact';
        throw new HttpException(message, status);
      }
      // handle non-Axios errors
      throw new HttpException(
        'An unexpected error occurred',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
