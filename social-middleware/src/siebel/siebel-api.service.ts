import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { SiebelAuthService } from './siebel-auth.service';
import { PinoLogger } from 'nestjs-pino';
import {
  CaregiverTypeItem,
  CaregiverTypesResponse,
  IcmContactDetail,
} from './dto/caregiver-type-response.dto';
import { IcmCaregiverType } from './enums/icm-caregiver-type.enum';

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
  'Primary Contact Id'?: string;
  [key: string]: unknown;
}

export interface CreateNotificationData {
  serviceRequestNumber: string;
  owner: string;
}

export interface SiebelSRsResponse {
  items: SiebelSRResponse[];
  [key: string]: unknown;
}

export interface SiebelSRDetail {
  Id?: string;
  'Service Request Number'?: string;
  'Assigned To Id'?: string;
  'Assigned To'?: string;
  Status?: string;
  'ICM Stage'?: string;
  Resolution?: string;
  [key: string]: unknown;
}

export interface SiebelResourceCase {
  Id: string;
  Status: string;
  'Created Date': string;
  'Reopened Date': string;
  [key: string]: unknown;
}

export class SiebelApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'SiebelApiError';
  }
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

        if (items.length > 1) {
          this.logger.error(
            { bcscId, count: items.length },
            'Multiple contacts found for BCSC ID - ICM BCSC DID should be unique',
          );
          throw new Error(`Duplicate ICM contacts for BCSC ID: ${bcscId}`);
        }

        if (items.length === 0) {
          this.logger.info({ bcscId }, 'No contact found for BCSC DID');
          return null;
        }

        this.logger.info({ bcscId }, 'Contact found for BCSC ID');
        return result;
      }

      if (!result.Id) {
        this.logger.info({ bcscId }, 'No contact found for BCSC ID');
        return null;
      }

      this.logger.info({ bcscId }, 'Contact found for BCSC ID');
      return result;
    } catch (error) {
      // if they've never logged in before, we don't expect to find a value
      if (error instanceof SiebelApiError && error.status === 404) {
        this.logger.info({ bcscId }, 'No contact found for BCSC ID');
        return null;
      }
      this.logger.error(
        { error, bcscId },
        'Failed to search for contact by BCSC ID',
      );
      throw error;
    }
  }

  async getServiceRequestsByBcscId(bcscId: string): Promise<SiebelSRsResponse> {
    const endpoint = '/ServiceRequest/ServiceRequest';

    const params = {
      searchspec: `[ICM BCSC DID]='${bcscId}' AND [SR Type]='Caregiver Application'`,
      fields: 'Id, ICM Stage',
      ViewMode: 'Organization',
      ChildLinks: 'None',
      PageSize: 100,
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

        if (error.response?.status === 404) {
          this.logger.debug({ endpoint, params }, 'Resource not found (404)');
        } else {
          this.logger.error(
            { endpoint, params, status: error.response?.status, errorData },
            'GET request failed',
          );
        }

        throw this.handleError(error, errorData);
      }

      this.logger.error({ endpoint, params, error }, 'GET request failed');
      throw new Error('Unexpected error during Siebel GET request');
    }
  }

  /*
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
*/
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

  async createSRNotification(
    serviceRequestId: string,
    activityData: CreateNotificationData,
  ) {
    const endpoint = '/Activities/Activities';

    const payload = {
      Id: 'NULL',
      Type: 'Notification',
      'ICM Sub Type': 'Action Required',
      Description: `Caregiver Applicant has cancelled their application (${activityData.serviceRequestNumber})`,
      Priority: '3-Standard',
      Status: 'Open',
      'Action By': 'Staff',
      'Activity SR Id': serviceRequestId,
      'Primary Owner Id': activityData.owner,
    };

    this.logger.debug(
      `Creating notification activity for Service Request: ${serviceRequestId}`,
    );
    return await this.put(endpoint, payload);
  }

  async getIcmContactById(contactId: string): Promise<IcmContactDetail | null> {
    const endpoint = `/ICMContact/ICMContact/${contactId}`;
    const params = {
      fields: 'Id,First Name,Last Name,Birth Date,Primary Email',
      ChildLinks: 'None',
      ViewMode: 'Organization',
    };

    try {
      return await this.get<IcmContactDetail>(endpoint, params);
    } catch (error) {
      if (error instanceof SiebelApiError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async getIcmServiceRequestById(srId: string): Promise<SiebelSRDetail | null> {
    const endpoint = `/ServiceRequest/ServiceRequest/${srId}`;
    const params = {
      fields:
        'Id, Service Request Number, Assigned To Id, Assigned To, Status, ICM Stage, Resolution',
      ChildLinks: 'None',
      ViewMode: 'Organization',
    };
    try {
      return await this.get<SiebelSRDetail>(endpoint, params);
    } catch (error) {
      if (error instanceof SiebelApiError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async getOpenResourceCasesByContactId(
    contactId: string,
  ): Promise<SiebelResourceCase[]> {
    const endpoint = '/Cases/Case';
    const params = {
      SearchSpec: `([Key Player Id] = '${contactId}' AND [Type] = 'Resource' AND [Status] = 'Open')`,
      ViewMode: 'Catalog',
      fields: 'Id,Status,Created Date,Reopened Date',
      ChildLinks: 'None',
    };

    try {
      const result = await this.get<{
        items?: SiebelResourceCase | SiebelResourceCase[];
        Id?: string;
        [key: string]: unknown;
      }>(endpoint, params);

      if (result.items) {
        return Array.isArray(result.items) ? result.items : [result.items];
      }

      // single result returned directly without items wrapper
      if (result.Id) {
        return [result as unknown as SiebelResourceCase];
      }

      return [];
    } catch (error) {
      if (error instanceof SiebelApiError && error.status === 404) {
        return [];
      }
      throw error;
    }
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

  async getActiveCaregiverType(
    contactId: string,
    caregiverType: IcmCaregiverType,
  ): Promise<CaregiverTypeItem | null> {
    const endpoint = `/ICMContact/ICMContact/${contactId}/CaregiverTypes`;
    const params = {
      //SearchSpec: `([Caregiver Type] = '${caregiverType}')`,
      ChildLinks: 'None',
      ViewMode: 'Organization',
    };

    try {
      const raw = await this.get<CaregiverTypesResponse>(endpoint, params);
      const items: CaregiverTypeItem[] = raw.items
        ? Array.isArray(raw.items)
          ? raw.items
          : [raw.items]
        : (raw as unknown as CaregiverTypeItem).Id
          ? [raw as unknown as CaregiverTypeItem]
          : [];
      const active = items.find(
        (item) => item['Caregiver Type'] === caregiverType && !item['End Date'],
      );
      return active ?? null;
    } catch (error) {
      if (error instanceof SiebelApiError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async getNewKinshipSRsForProspectiveCaregivers(): Promise<
    SiebelSRResponse[]
  > {
    const params = {
      SearchSpec: `([SR Type]='Caregiver Application' AND [SR Sub Type]='Kinship' AND [ICM Stage]='Referral' AND [Primary Contact Id] <> '' AND [Primary Contact Id] <> 'No Match Row Id')`,
      fields: 'Id,Primary Contact Id,ICM Stage,SR Sub Type',
      ViewMode: 'Organization',
      ChildLinks: 'None',
    };

    const result = await this.get<SiebelSRsResponse>(
      '/ServiceRequest/ServiceRequest',
      params,
    );

    const srs: SiebelSRResponse[] = result.items
      ? Array.isArray(result.items)
        ? result.items
        : [result.items]
      : [];

    const matched = await Promise.all(
      srs.map(async (sr) => {
        const contactId = sr['Primary Contact Id'];
        if (!contactId) return null;
        const caregiverType = await this.getActiveCaregiverType(
          contactId,
          IcmCaregiverType.PROSPECTIVE_CAREGIVER,
        );
        return caregiverType ? sr : null;
      }),
    );

    return matched.filter((sr): sr is SiebelSRResponse => sr !== null);
  }

  private handleError(error: AxiosError, errorData: unknown): SiebelApiError {
    const upstreamMessage = (errorData as { message?: string })?.message;
    if (error.response?.status === 401) {
      return new SiebelApiError(
        upstreamMessage ||
          'Unauthorized: Check your Siebel credentials and trusted username',
        401,
      );
    }

    if (error.response?.status === 403) {
      return new SiebelApiError(
        upstreamMessage ||
          'Forbidden: Insufficient permissions or blacklisted user',
        403,
      );
    }

    const message =
      upstreamMessage || error.message || 'Siebel API request failed';

    return new SiebelApiError(message, error.response?.status);
  }
}
