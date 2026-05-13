import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { SiebelAuthService } from './siebel-auth.service';
import { PinoLogger } from 'nestjs-pino';
import {
  ApplicationPackageSubType,
  ApplicationPackageSubSubType,
} from 'src/application-package/enums/application-package-subtypes.enum';
//import { Builder } from 'xml2js';

interface SiebelContactResponse {
  Id?: string;
  Link?: unknown[];
  items?: unknown[];
  [key: string]: unknown;
}

export interface SiebelSRResponse {
  Id?: string;
  'ICM BCSC DID'?: string;
  'ICM Stage'?: string;
  [key: string]: unknown;
}

export interface SiebelSRsResponse {
  items: SiebelSRResponse[];
  [key: string]: unknown;
}
@Injectable()
export class SiebelApiService {
  private readonly baseUrl: string;
  private readonly trustedUsername: string;

  //private readonly logger = new Logger(SiebelApiService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly siebelAuthService: SiebelAuthService,
    private readonly logger: PinoLogger,
  ) {
    this.baseUrl = this.configService.get<string>('SIEBEL_APS_BASE_URL')!;
    this.trustedUsername = this.configService.get<string>(
      'SIEBEL_TRUSTED_USERNAME',
    )!;
    this.logger.setContext(SiebelApiService.name);
  }

  private async getHeaders(): Promise<Record<string, string>> {
    const accessToken = await this.siebelAuthService.getAccessToken();

    return {
      Authorization: `Bearer ${accessToken}`,
      'X-ICM-TrustedUsername': this.trustedUsername,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Encoding': 'identity',
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
    const endpoint = '/ServiceRequest/ServiceRequest';
    return await this.get(endpoint, query);
  }

  async getContactByBcscId(
    bcscId: string,
  ): Promise<SiebelContactResponse | null> {
    const endpoint = '/ICMContact/ICMContact';

    const params = {
      SearchSpec: `([ICM BCSC DID] = '${bcscId}' )`,
      fields: 'Id',
      ChildLinks: 'None',
    };
    this.logger.debug({ bcscId }, 'Searching for contact with BCSC ID');

    try {
      const result = await this.get<SiebelContactResponse>(endpoint, params);

      if (result.items) {
        const items = Array.isArray(result.items)
          ? result.items
          : [result.items];
        this.logger.error(
          { bcscId, count: items.length },
          'Multiple contacts found for BCSC ID - ICM BCSC DID should be unique',
        );
        throw new Error(`Duplicate ICM contacts for BCSC ID: ${bcscId}`);
      }

      if (!result.Id) {
        this.logger.info({ bcscId }, 'No contact found for BCSC ID');
        return null;
      }

      this.logger.info({ bcscId }, 'Contact found for BCSC ID');
      return result;
    } catch (error) {
      this.logger.error(
        { error, bcscId },
        'Failed to search for contact by BCSC ID',
      );
      throw error;
    }
  }

  async getServiceRequestsByBcscId(bcscId: string): Promise<SiebelSRsResponse> {
    const endpoint = '/ServiceRequest/ServiceRequest';
    //const encodedBcscId = encodeURIComponent(bcscId); // get around special characters

    const params = {
      searchspec: `[ICM BCSC DID]='${bcscId}' AND [SR Type]='Caregiver Application'`,
      fields: 'Id, ICM Stage',
      ViewMode: 'Organization',
      ChildLinks: 'None',
      PageSize: 100,
      //'ICM BCSC DID': bcscId,
      //'SR Type': 'Caregiver Application',
    };

    const rawResponse = await this.get<{
      items?: SiebelSRResponse | SiebelSRResponse[];
      [key: string]: unknown;
    }>(endpoint, params);

    // Normalize items to always be an array
    const items: SiebelSRResponse[] = rawResponse?.items
      ? Array.isArray(rawResponse.items)
        ? rawResponse.items
        : [rawResponse.items]
      : [];

    return {
      ...rawResponse,
      items,
    };
  }

  async get<T>(endpoint: string, params?: Record<string, any>): Promise<T> {
    try {
      const headers = await this.getHeaders();
      const url = `${this.baseUrl}${endpoint}`;

      const response = await firstValueFrom(
        this.httpService.get<T>(url, { headers, params }),
      );

      this.logger.debug({ endpoint, params }, 'GET request successful');
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

  async createCaregiverApplicationSR(
    subtype: ApplicationPackageSubType,
    subsubtype: ApplicationPackageSubSubType,
    bcscDID: string,
    contactId?: string,
    activityId?: string,
  ): Promise<{ srId: string }> {
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
    const envSuffix = nodeEnv.toLowerCase().includes('prod') ? '' : nodeEnv;

    const srPayload = {
      Id: 'NULL',
      Status: 'Open',
      Priority: '3-Standard',
      Type: 'Caregiver Application',
      'SR Sub Type': subtype,
      'SR Sub Sub Type': subsubtype,
      'ICM BCSC DID': bcscDID,
      'Service Office': 'XRA',
      'Comm Method': 'Client Portal',
      Memo: `Created By ${envSuffix} Portal`,
    };

    const siebelResponse = await this.createServiceRequest(srPayload);

    if (!siebelResponse) {
      throw new InternalServerErrorException(
        'Failed to create service request',
      );
    }

    const srId = (siebelResponse as { items?: { Id?: string } })?.items?.Id;

    if (!srId) {
      this.logger.error(
        { siebelResponse },
        'No service request ID in response',
      );
      throw new InternalServerErrorException(
        'Failed to get service request ID from Siebel',
      );
    }

    return { srId };
  }

  async createServiceRequest(serviceRequestData: unknown) {
    const endpoint = '/ServiceRequest/ServiceRequest';
    try {
      return await this.put(endpoint, serviceRequestData);
    } catch (error: unknown) {
      // Log the raw error first
      this.logger.error('Raw error object:', error);

      // Try different error structure patterns
      if (error && typeof error === 'object') {
        this.logger.error('Error keys:', Object.keys(error));

        // Axios error structure
        if ('response' in error) {
          const axiosError = error as AxiosError;
          this.logger.error('Axios response:', axiosError.response);
          this.logger.error('Axios status:', axiosError.response?.status);
          this.logger.error('Axios data:', axiosError.response?.data);
        }

        // Other error patterns
        if ('message' in error) {
          this.logger.error('Error message:', (error as any).message);
        }
      }

      throw error;
    }
  }

  async updateServiceRequestStage(
    serviceRequestId: string,
    newStage: string,
  ): Promise<SiebelSRResponse> {
    const endpoint = `/ServiceRequest/ServiceRequest/${serviceRequestId}`;
    const params = {
      ViewMode: 'Catalog',
    };
    const payload = {
      'ICM Stage': newStage,
    };
    this.logger.debug(
      `Updating Service Request ${serviceRequestId} to stage: ${newStage}`,
    );
    try {
      return await this.put(endpoint, payload, params);
    } catch (error) {
      this.logger.error(
        { error, serviceRequestId, newStage },
        'Failed to update Service Request stage',
      );
      throw error;
    }
  }

  async updateServiceRequestFields(
    serviceRequestId: string,
    fields: Record<string, any>,
  ): Promise<SiebelSRResponse> {
    const endpoint = `/ServiceRequest/ServiceRequest/${serviceRequestId}`;
    const params = {
      ViewMode: 'Organization',
    };

    this.logger.debug(
      { serviceRequestId, fields },
      'Updating Service Request fields',
    );

    try {
      return await this.put(endpoint, fields, params);
      //return await this.put(endpoint, fields);
    } catch (error) {
      this.logger.error(
        { error, serviceRequestId, fields },
        'Failed to update Service Request fields',
      );
      throw error;
    }
  }

  async createAttachment(
    serviceRequestId: string,
    attachmentData: {
      fileName: string;
      fileContent: string; // base64 encoded string
      fileType: string;
      description: string;
      category: string;
    },
  ) {
    const endpoint = '/Attachment/Attachment';
    const payload = {
      'SR Id': serviceRequestId,
      Id: 'NULL',
      'Memo Id': 'NULL',
      'Memo Number': '',
      Categorie: 'Attachment',
      Category: attachmentData.category,
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

  async createFormAttachment(
    serviceRequestId: string,
    attachmentData: {
      fileName: string;
      template: string;
      xmlHierarchy: string;
      fileContent: string;
    },
  ) {
    const endpoint = '/ICM REST Forms Upsert/DT Form Instance Orbeon Revise/';
    const payload = {
      Id: 'NULL',
      'SR Id': serviceRequestId,
      Categorie: 'Service Request',
      DocFileExt: 'json',
      DocFileName: attachmentData.fileName,
      'Office Name': 'MCFD',
      Status: 'Complete', // document will be readonly in ICM
      Template: attachmentData.template,
      'Final Flag': 'N',
      'XML Hierarchy': attachmentData.xmlHierarchy,
      'Doc Attachment Id': attachmentData.fileContent,
    };
    return await this.put(endpoint, payload);
  }

  async createProspect(prospectData: {
    ServiceRequestId: string;
    IcmBcscDid: string;
    FirstName: string;
    MiddleName: string;
    LastName: string;
    DateofBirth: string;
    StreetAddress: string;
    City: string;
    Prov: string;
    PostalCode: string;
    EmailAddress: string;
    HomePhone: string;
    AlternatePhone: string;
    Gender: string;
    Relationship: string;
    ApplicantFlag: string;
  }) {
    const endpoint = '/Prospects/SRProspects/';

    const payload = {
      Id: 'NULL',
      'Service Request Id': prospectData.ServiceRequestId,
      'ICM BCSC DID': prospectData.IcmBcscDid,
      'First Name': prospectData.FirstName,
      'Middle Name': prospectData.MiddleName,
      'Last Name': prospectData.LastName,
      'Birth Date': prospectData.DateofBirth,
      'Street Address': prospectData.StreetAddress,
      City: prospectData.City,
      State: prospectData.Prov,
      'Postal Code': prospectData.PostalCode,
      'Email Address': prospectData.EmailAddress,
      'Home Phone #': prospectData.HomePhone,
      'Alternate Phone #': prospectData.AlternatePhone,
      'M/F': prospectData.Gender,
      'Portal Role': prospectData.Relationship,
      'Applicant Flag': prospectData.ApplicantFlag,
    };
    this.logger.debug(
      `Creating prospect for Service Request: ${prospectData.ServiceRequestId}`,
      payload,
    );
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

      this.logger.debug({ endpoint, data, params }, 'PUT request successful');
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
            statusText: error.response?.statusText,
            errorData,
            errorMessage: error.message,
            errorStack: error.stack,
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
