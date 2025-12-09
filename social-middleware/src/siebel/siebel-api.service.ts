import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { SiebelAuthService } from './siebel-auth.service';
import { PinoLogger } from 'nestjs-pino';
//import { Builder } from 'xml2js';

interface SiebelContactResponse {
  items?: {
    Id?: string;
    'ICM BCSC DID'?: string;
    [key: string]: unknown;
  };
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

  async getContactByBcscId(
    bcscId: string,
  ): Promise<SiebelContactResponse | null> {
    const endpoint = '/ICMContact/ICMContact';

    const params = {
      'ICM BCSC DID': bcscId,
    };
    this.logger.debug(`Searching for contact with BCSC ID: ${bcscId}`);

    try {
      const result = await this.get<SiebelContactResponse>(endpoint, params);

      // Check if contact exists
      if (
        result &&
        (Array.isArray(result) ? result.length > 0 : result.items)
      ) {
        this.logger.info({ bcscId }, 'Contact found for BCSC ID');
        return result;
      } else {
        this.logger.info({ bcscId }, 'No contact found for BCSC ID');
        return null;
      }
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
      ViewMode: 'Organization',
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
          const axiosError = error as any;
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
    const payload = {
      'ICM Stage': newStage,
    };
    this.logger.debug(
      `Updating Service Request ${serviceRequestId} to stage: ${newStage}`,
    );
    try {
      return await this.put(endpoint, payload);
    } catch (error) {
      this.logger.error(
        { error, serviceRequestId, newStage },
        'Failed to update Service Request stage',
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

  /*
  async createForm(attachmentData, formData: string) {
    const endpoint = '/ICM REST Forms Upsert/DT Form Instance Orbeon Revise/';
    const payload = {};

    const decodedFormData = JSON.parse(
      Buffer.from(formData, 'base64').toString('utf-8'),
    ) as {
      data: Record<string, unknown>;
      form_definition: {
        data: {
          items?: unknown[];
        };
        elements?: unknown[];
      };
    };
*/
  /**
   * Apply Kiln Version
   * Kiln V1 uses data: { items: []}
   * Kiln V2 uses dataSources []
   */
  /*
    const kilnVersion = Object.keys(
      decodedFormData.form_definition.data,
    ).includes('items')
      ? 1
      : 2;

    const formDefinitionItems =
      kilnVersion === 1
        ? decodedFormData.form_definition.data.items
        : decodedFormData.form_definition.elements; // This is the field info for form items

    // dateItemsId : This will contain all of the IDs of the date fields
    // checkboxItemsId : This will contain all of the IDs of the checkbox fields
    const { dateItemsId, checkboxItemsId, textInfoFields } = this.getFormIds(
      formDefinitionItems || [],
    );

    // note: skipped form exceptions for now..

    // Transform the data for XML
    const simplifiedData = this.fixJSONValuesForXML(
      decodedFormData.data,
      dateItemsId,
      checkboxItemsId,
      textInfoFields,
      kilnVersion,
    );

    // Generate XML Hierarchy
    const builder = new Builder({
      xmldec: { version: '1.0' },
      renderOpts: { pretty: false },
      rootName: 'root',
    });

    const xmlHierarchy = builder.buildObject(simplifiedData);
    if (isFormException) {
      // If any forms with the correct version (TODO) have been listed as exceptions, then proceed with their form exceptions
      // If the root needs a differernt name, apply it here. Otherwise use the default "root"
      if (
        propertyExists(dictionary, formId, 'rootName') &&
        propertyNotEmpty(dictionary, formId, 'rootName')
      ) {
        builder = new xml2js.Builder({
          xmldec: { version: '1.0' },
          renderOpts: { pretty: false },
          rootName: dictionary[formId]['rootName'],
        });
      } else {
        builder = new xml2js.Builder({
          xmldec: { version: '1.0' },
          renderOpts: { pretty: false },
        });
      }

      let wrapperJson = truncatedKeysSaveData;
      // If subRoots exist, wrap the sub-roots around the JSON where the last array object will be closest to JSON and first array object will be closest to root/rootName
      if (
        propertyExists(dictionary, formId, 'subRoots') &&
        propertyNotEmpty(dictionary, formId, 'subRoots')
      ) {
        wrapperJson = {};
        let tempJson = {};
        const subRootLength = dictionary[formId]['subRoots'].length;
        for (i = subRootLength; i > 0; i = i - 1) {
          if (i === subRootLength) {
            tempJson[dictionary[formId]['subRoots'][i - 1]] =
              truncatedKeysSaveData;
          } else {
            wrapperJson[dictionary[formId]['subRoots'][i - 1]] = tempJson;
            tempJson = wrapperJson;
            wrapperJson = {};
          }
        }
        wrapperJson = tempJson;
      }
      saveJson['XML Hierarchy'] = builder.buildObject(wrapperJson);
    } else {
      builder = new xml2js.Builder({
        xmldec: { version: '1.0' },
        renderOpts: { pretty: false },
      });
      saveJson['XML Hierarchy'] = builder.buildObject(truncatedKeysSaveData);
    }
    //let url = buildUrlWithParams('SIEBEL_ICM_API_HOST', 'fwd/v1.0/data/DT Form Instance Thin/DT Form Instance Thin/' + attachment_id + '/', '');
    const xml = saveJson['XML Hierarchy'];
    const xmlSize = Buffer.byteLength(xml, 'utf8'); // size in bytes

    console.log('XML Hierarchy:', xml);
    console.log('XML Hierarchy length (chars):', xml.length);
    console.log('XML Hierarchy size (bytes):', xmlSize);

    return await this.put(endpoint, payload);
  }
*/
  async createProspect(prospectData: {
    ServiceRequestId: string;
    IcmBcscDid: string;
    FirstName: string;
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
  }) {
    const endpoint = '/Prospects/SRProspects/';
    const payload = {
      Id: 'NULL',
      'Service Request Id': prospectData.ServiceRequestId,
      'ICM BCSC DID': prospectData.IcmBcscDid,
      'First Name': prospectData.FirstName,
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
