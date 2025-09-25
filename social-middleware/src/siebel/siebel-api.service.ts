import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { SiebelAuthService } from './siebel-auth.service';

@Injectable()
export class SiebelApiService {
  private readonly baseUrl: string;
  private readonly trustedUsername: string;

  private readonly logger = new Logger(SiebelApiService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly siebelAuthService: SiebelAuthService,
  ) {
    this.baseUrl = this.configService.get<string>('SIEBEL_APS_BASE_URL')!;
    this.trustedUsername = this.configService.get<string>(
      'SIEBEL_TRUSTED_USERNAME',
    )!;
  }

  private async getHeaders(): Promise<Record<string, string>> {
    const accessToken = await this.siebelAuthService.getAccessToken();

    return {
      Authorization: `Bearer ${accessToken}`,
      'X-ICM-TrustedUsername': this.trustedUsername,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  async getCaseContacts(query: any) {
    const endpoint = this.configService.get<string>('CASE_CONTACTS_ENDPOINT');
    if (!endpoint) {
      throw new Error('CASE_CONTACTS_ENDPOINT configuration is missing');
    }
    return await this.get(endpoint, query);
  }

  async getServiceRequests(query: any) {
    const endpoint = this.configService.get<string>(
      'SERVICE_REQUESTS_ENDPOINT',
    );
    if (!endpoint) {
      throw new Error('SERVICE_REQUESTS_ENDPOINT configuration is missing');
    }
    return await this.get(endpoint, query);
  }

  async getServiceRequestsByBcscId(bcscId: string) {
    const endpoint = '/ServiceRequest/ServiceRequest';

    const params = {
      'Icm Bcsc Did': bcscId,
      Type: 'Caregiver Application',
    };
    return await this.get(endpoint, params);
  }

  async get<T>(endpoint: string, params?: Record<string, any>): Promise<T> {
    try {
      const headers = await this.getHeaders();
      const url = `${this.baseUrl}${endpoint}`;

      const response = await firstValueFrom(
        this.httpService.get<T>(url, { headers, params }),
      );

      this.logger.log({ endpoint, params }, 'GET request successful');
      return response.data;
    } catch (error: unknown) {
      if (error instanceof AxiosError) {
        const errorData = error.response?.data as unknown;

        this.logger.error(
          {
            endpoint,
            params,
            status: error.response?.status,
            errorData,
          },
          'GET request failed',
        );

        throw this.handleError(error, errorData);
      }

      this.logger.error({ endpoint, params, error }, 'GET request failed');
      throw new Error('Unexpected error during Siebel GET request');
    }
  }

  async createServiceRequest(serviceRequestData: unknown) {
    const endpoint = '/ServiceRequest/ServiceRequest';
    return await this.put(endpoint, serviceRequestData);
  }

  async createAttachment(
    serviceRequestId: string,
    attachmentData: {
      fileName: string;
      fileContent: string; // base64 encoded string
      fileType: string;
      description: string;
    },
  ) {
    const endpoint = '/Attachment/Attachment';
    const payload = {
      'SR Id': serviceRequestId,
      'Memo Id': 'NULL',
      'Memo Number': '',
      Categorie: 'Attachment',
      Category: 'Decision',
      Status: 'Complete',
      FileExt: attachmentData.fileType,
      FileName: attachmentData.fileName,
      'Attachment Id': attachmentData.fileContent,
      Description: attachmentData.description,
    };
    this.logger.debug(
      `Creating attachment for Service Request: ${serviceRequestId}`,
    );
    return await this.put(endpoint, payload);
  }

  async createProspect() {
    const endpoint = '/Prospects/SRProspects/';
    const payload = {};
    return await this.put(endpoint, payload);
  }

  async put<T>(
    endpoint: string,
    data?: unknown,
    params?: Record<string, any>,
  ): Promise<T> {
    try {
      const headers = await this.getHeaders();
      const url = `${this.baseUrl}${endpoint}`;

      const response = await firstValueFrom(
        this.httpService.put<T>(url, data, { headers, params }),
      );

      this.logger.log({ endpoint, data, params }, 'PUT request successful');
      return response.data;
    } catch (error: unknown) {
      if (error instanceof AxiosError) {
        const errorData = error.response?.data as unknown;

        this.logger.error(
          {
            endpoint,
            data,
            params,
            status: error.response?.status,
            errorData,
          },
          'PUT request failed',
        );

        throw this.handleError(error, errorData);
      }
      this.logger.error(
        { endpoint, data, params, error },
        'PUT request failed',
      );
      throw new Error('Unexpected error during Siebel PUT request');
    }
  }

  private handleError(error: AxiosError, errorData: unknown): Error {
    if (error.response?.status === 401) {
      return new Error(
        'Unauthorized: Check your Siebel credentials and trusted username',
      );
    }

    if (error.response?.status === 403) {
      return new Error(
        'Forbidden: Insufficient permissions or blacklisted user',
      );
    }

    const message =
      (errorData as { message?: string })?.message ||
      error.message ||
      'Siebel API request failed';

    return new Error(message);
  }
}
