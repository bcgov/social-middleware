import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { AxiosError } from 'axios';
import { SiebelApiService } from '../siebel-api.service';
import { SiebelAuthService } from '../siebel-auth.service';
import { PinoLogger } from 'nestjs-pino';
import {
  ApplicationPackageSubType,
  ApplicationPackageSubSubType,
} from 'src/application-package/enums/application-package-subtypes.enum';

const mockLogger = {
  setContext: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const mockSiebelAuthService = {
  getAccessToken: jest.fn().mockResolvedValue('mock-token'),
};

const mockConfigService = {
  get: jest.fn((key: string) => {
    const config: Record<string, string> = {
      SIEBEL_APS_BASE_URL: 'https://siebel.example.com',
      SIEBEL_TRUSTED_USERNAME: 'trusted-user',
    };
    return config[key];
  }),
};

describe('SiebelApiService.getContactByBcscId', () => {
  let service: SiebelApiService;
  let httpService: { get: jest.Mock };

  beforeEach(async () => {
    httpService = { get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SiebelApiService,
        { provide: HttpService, useValue: httpService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: SiebelAuthService, useValue: mockSiebelAuthService },
        { provide: PinoLogger, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<SiebelApiService>(SiebelApiService);
    jest.clearAllMocks();
    mockSiebelAuthService.getAccessToken.mockResolvedValue('mock-token');
  });

  it('returns null when ICM returns no items', async () => {
    httpService.get.mockReturnValue(of({ data: {} }));

    const result = await service.getContactByBcscId('did-123');

    expect(result).toBeNull();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ bcscId: 'did-123' }),
      expect.stringContaining('No contact found'),
    );
  });

  it('returns the response when exactly one contact is found', async () => {
    const mockResponse = {
      items: [{ Id: 'contact-abc', 'ICM BCSC DID': 'did-123' }],
    };
    httpService.get.mockReturnValue(of({ data: mockResponse }));

    const result = await service.getContactByBcscId('did-123');

    expect(result).toEqual(mockResponse);
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ bcscId: 'did-123' }),
      expect.stringContaining('Contact found'),
    );
  });

  it('throws and logs when multiple contacts are returned', async () => {
    const mockResponse = {
      items: [
        { Id: 'contact-1', 'ICM BCSC DID': 'did-123' },
        { Id: 'contact-2', 'ICM BCSC DID': 'did-123' },
      ],
    };
    httpService.get.mockReturnValue(of({ data: mockResponse }));

    await expect(service.getContactByBcscId('did-123')).rejects.toThrow(
      'Duplicate ICM contacts for BCSC ID: did-123',
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ bcscId: 'did-123', count: 2 }),
      expect.stringContaining('Multiple contacts'),
    );
  });

  it('throws and logs when the HTTP call fails', async () => {
    const axiosError = new AxiosError('Network error');
    httpService.get.mockReturnValue(throwError(() => axiosError));

    await expect(service.getContactByBcscId('did-123')).rejects.toThrow();
    expect(mockLogger.error).toHaveBeenCalled();
  });
});

// ─── shared helpers ───────────────────────────────────────────────────────────

const createAxiosError = (status: number, data?: unknown): AxiosError => {
  const error = new AxiosError('Request failed');
  Object.defineProperty(error, 'response', {
    value: { status, data, statusText: 'Error', headers: {}, config: {} },
    writable: true,
    configurable: true,
  });
  return error;
};

const makeModule = async (
  httpService: { get?: jest.Mock; put?: jest.Mock },
  configOverrides: Record<string, string> = {},
): Promise<SiebelApiService> => {
  const configValues: Record<string, string> = {
    SIEBEL_APS_BASE_URL: 'https://siebel.example.com',
    SIEBEL_TRUSTED_USERNAME: 'trusted-user',
    ...configOverrides,
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SiebelApiService,
      { provide: HttpService, useValue: httpService },
      {
        provide: ConfigService,
        useValue: {
          get: jest.fn(
            (key: string, fallback?: string) => configValues[key] ?? fallback,
          ),
        },
      },
      { provide: SiebelAuthService, useValue: mockSiebelAuthService },
      { provide: PinoLogger, useValue: mockLogger },
    ],
  }).compile();

  return module.get<SiebelApiService>(SiebelApiService);
};

// ─── get() ────────────────────────────────────────────────────────────────────

describe('SiebelApiService - get()', () => {
  let service: SiebelApiService;
  let httpGet: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSiebelAuthService.getAccessToken.mockResolvedValue('mock-token');
    httpGet = jest.fn();
    service = await makeModule({ get: httpGet });
  });

  it('returns response data on success', async () => {
    httpGet.mockReturnValue(of({ data: { Id: 'abc' } }));
    const result = await service.get('/some/endpoint');
    expect(result).toEqual({ Id: 'abc' });
  });

  it('calls the correct URL', async () => {
    httpGet.mockReturnValue(of({ data: {} }));
    await service.get('/some/endpoint', { foo: 'bar' });
    expect(httpGet).toHaveBeenCalledWith(
      'https://siebel.example.com/some/endpoint',
      expect.objectContaining({ params: { foo: 'bar' } }),
    );
  });

  it('includes the Bearer token and trusted username in headers', async () => {
    httpGet.mockReturnValue(of({ data: {} }));
    await service.get('/some/endpoint');
    const headers = httpGet.mock.calls[0][1].headers;
    expect(headers['Authorization']).toBe('Bearer mock-token');
    expect(headers['X-ICM-TrustedUsername']).toBe('trusted-user');
  });

  it('throws with unauthorized message on 401', async () => {
    httpGet.mockReturnValue(throwError(() => createAxiosError(401)));
    await expect(service.get('/endpoint')).rejects.toThrow(
      'Unauthorized: Check your Siebel credentials and trusted username',
    );
  });

  it('throws with forbidden message on 403', async () => {
    httpGet.mockReturnValue(throwError(() => createAxiosError(403)));
    await expect(service.get('/endpoint')).rejects.toThrow(
      'Forbidden: Insufficient permissions or blacklisted user',
    );
  });

  it('uses the error data message when available', async () => {
    httpGet.mockReturnValue(
      throwError(() => createAxiosError(500, { message: 'ICM is down' })),
    );
    await expect(service.get('/endpoint')).rejects.toThrow('ICM is down');
  });

  it('throws a generic error for non-AxiosErrors', async () => {
    httpGet.mockReturnValue(throwError(() => new Error('socket hang up')));
    await expect(service.get('/endpoint')).rejects.toThrow(
      'Unexpected error during Siebel GET request',
    );
  });
});

// ─── put() ────────────────────────────────────────────────────────────────────

describe('SiebelApiService - put()', () => {
  let service: SiebelApiService;
  let httpPut: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSiebelAuthService.getAccessToken.mockResolvedValue('mock-token');
    httpPut = jest.fn();
    service = await makeModule({ put: httpPut });
  });

  it('returns response data on success', async () => {
    httpPut.mockReturnValue(of({ data: { items: { Id: 'sr-001' } } }));
    const result = await service.put('/some/endpoint', { field: 'value' });
    expect(result).toEqual({ items: { Id: 'sr-001' } });
  });

  it('calls the correct URL with data and params', async () => {
    httpPut.mockReturnValue(of({ data: {} }));
    await service.put(
      '/ServiceRequest/ServiceRequest',
      { key: 'val' },
      { ViewMode: 'Catalog' },
    );
    expect(httpPut).toHaveBeenCalledWith(
      'https://siebel.example.com/ServiceRequest/ServiceRequest',
      { key: 'val' },
      expect.objectContaining({ params: { ViewMode: 'Catalog' } }),
    );
  });

  it('throws with unauthorized message on 401', async () => {
    httpPut.mockReturnValue(throwError(() => createAxiosError(401)));
    await expect(service.put('/endpoint', {})).rejects.toThrow(
      'Unauthorized: Check your Siebel credentials and trusted username',
    );
  });

  it('throws with forbidden message on 403', async () => {
    httpPut.mockReturnValue(throwError(() => createAxiosError(403)));
    await expect(service.put('/endpoint', {})).rejects.toThrow(
      'Forbidden: Insufficient permissions or blacklisted user',
    );
  });

  it('throws a generic error for non-AxiosErrors', async () => {
    httpPut.mockReturnValue(throwError(() => new Error('timeout')));
    await expect(service.put('/endpoint', {})).rejects.toThrow(
      'Unexpected error during Siebel PUT request',
    );
  });
});

// ─── getCaseContacts() ────────────────────────────────────────────────────────

describe('SiebelApiService - getCaseContacts()', () => {
  it('throws when CASE_CONTACTS_ENDPOINT is not configured', async () => {
    const httpGet = jest.fn();
    const service = await makeModule({ get: httpGet }); // no CASE_CONTACTS_ENDPOINT in config

    await expect(service.getCaseContacts({})).rejects.toThrow(
      'CASE_CONTACTS_ENDPOINT configuration is missing',
    );
    expect(httpGet).not.toHaveBeenCalled();
  });

  it('calls the configured endpoint', async () => {
    const httpGet = jest.fn().mockReturnValue(of({ data: {} }));
    const service = await makeModule(
      { get: httpGet },
      { CASE_CONTACTS_ENDPOINT: '/CaseContacts/Contacts' },
    );

    await service.getCaseContacts({ query: 'test' });

    expect(httpGet).toHaveBeenCalledWith(
      'https://siebel.example.com/CaseContacts/Contacts',
      expect.anything(),
    );
  });
});

// ─── getServiceRequestsByBcscId() ─────────────────────────────────────────────

describe('SiebelApiService - getServiceRequestsByBcscId()', () => {
  let service: SiebelApiService;
  let httpGet: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSiebelAuthService.getAccessToken.mockResolvedValue('mock-token');
    httpGet = jest.fn();
    service = await makeModule({ get: httpGet });
  });

  it('returns an empty items array when no items in response', async () => {
    httpGet.mockReturnValue(of({ data: {} }));
    const result = await service.getServiceRequestsByBcscId('did-123');
    expect(result.items).toEqual([]);
  });

  it('normalizes a single item object to an array', async () => {
    const item = { Id: 'sr-001', 'ICM Stage': 'Application' };
    httpGet.mockReturnValue(of({ data: { items: item } }));
    const result = await service.getServiceRequestsByBcscId('did-123');
    expect(result.items).toEqual([item]);
  });

  it('passes through an array of items unchanged', async () => {
    const items = [
      { Id: 'sr-001', 'ICM Stage': 'Application' },
      { Id: 'sr-002', 'ICM Stage': 'Screening' },
    ];
    httpGet.mockReturnValue(of({ data: { items } }));
    const result = await service.getServiceRequestsByBcscId('did-123');
    expect(result.items).toEqual(items);
  });
});

// ─── createCaregiverApplicationSR() ───────────────────────────────────────────

describe('SiebelApiService - createCaregiverApplicationSR()', () => {
  let httpPut: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSiebelAuthService.getAccessToken.mockResolvedValue('mock-token');
    httpPut = jest.fn();
  });

  it('returns srId from a successful response', async () => {
    httpPut.mockReturnValue(of({ data: { items: { Id: 'sr-999' } } }));
    const service = await makeModule(
      { put: httpPut },
      { NODE_ENV: 'production' },
    );

    const result = await service.createCaregiverApplicationSR(
      ApplicationPackageSubType.FCH,
      ApplicationPackageSubSubType.FCH,
      'bcsc-did-001',
    );

    expect(result).toEqual({ srId: 'sr-999' });
  });

  it('throws InternalServerErrorException when createServiceRequest returns falsy', async () => {
    httpPut.mockReturnValue(of({ data: null }));
    const service = await makeModule({ put: httpPut });

    await expect(
      service.createCaregiverApplicationSR(
        ApplicationPackageSubType.FCH,
        ApplicationPackageSubSubType.FCH,
        'bcsc-did-001',
      ),
    ).rejects.toThrow('Failed to create service request');
  });

  it('throws InternalServerErrorException when srId is missing from response', async () => {
    httpPut.mockReturnValue(of({ data: { items: {} } }));
    const service = await makeModule({ put: httpPut });

    await expect(
      service.createCaregiverApplicationSR(
        ApplicationPackageSubType.FCH,
        ApplicationPackageSubSubType.FCH,
        'bcsc-did-001',
      ),
    ).rejects.toThrow('Failed to get service request ID from Siebel');
  });

  it('appends NODE_ENV to the Memo for non-production environments', async () => {
    httpPut.mockReturnValue(of({ data: { items: { Id: 'sr-001' } } }));
    const service = await makeModule(
      { put: httpPut },
      { NODE_ENV: 'development' },
    );

    await service.createCaregiverApplicationSR(
      ApplicationPackageSubType.FCH,
      ApplicationPackageSubSubType.FCH,
      'bcsc-did-001',
    );

    const payload = httpPut.mock.calls[0][1];
    expect(payload.Memo).toContain('development');
  });

  it('omits an env suffix from Memo in production', async () => {
    httpPut.mockReturnValue(of({ data: { items: { Id: 'sr-001' } } }));
    const service = await makeModule(
      { put: httpPut },
      { NODE_ENV: 'production' },
    );

    await service.createCaregiverApplicationSR(
      ApplicationPackageSubType.FCH,
      ApplicationPackageSubSubType.FCH,
      'bcsc-did-001',
    );

    const payload = httpPut.mock.calls[0][1];
    expect(payload.Memo).toBe('Created By  Portal');
  });
});

// ─── updateServiceRequestStage() ──────────────────────────────────────────────

describe('SiebelApiService - updateServiceRequestStage()', () => {
  let service: SiebelApiService;
  let httpPut: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSiebelAuthService.getAccessToken.mockResolvedValue('mock-token');
    httpPut = jest.fn().mockReturnValue(of({ data: {} }));
    service = await makeModule({ put: httpPut });
  });

  it('calls the correct endpoint with the new stage payload', async () => {
    await service.updateServiceRequestStage('sr-001', 'Screening');

    expect(httpPut).toHaveBeenCalledWith(
      'https://siebel.example.com/ServiceRequest/ServiceRequest/sr-001',
      { 'ICM Stage': 'Screening' },
      expect.objectContaining({ params: { ViewMode: 'Catalog' } }),
    );
  });

  it('rethrows errors from the PUT call', async () => {
    httpPut.mockReturnValue(
      throwError(() => createAxiosError(500, { message: 'Siebel error' })),
    );
    await expect(
      service.updateServiceRequestStage('sr-001', 'Screening'),
    ).rejects.toThrow('Siebel error');
  });
});

// ─── updateServiceRequestFields() ─────────────────────────────────────────────

describe('SiebelApiService - updateServiceRequestFields()', () => {
  let service: SiebelApiService;
  let httpPut: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSiebelAuthService.getAccessToken.mockResolvedValue('mock-token');
    httpPut = jest.fn().mockReturnValue(of({ data: {} }));
    service = await makeModule({ put: httpPut });
  });

  it('calls the correct endpoint with the provided fields', async () => {
    await service.updateServiceRequestFields('sr-001', { Status: 'Closed' });

    expect(httpPut).toHaveBeenCalledWith(
      'https://siebel.example.com/ServiceRequest/ServiceRequest/sr-001',
      { Status: 'Closed' },
      expect.objectContaining({ params: { ViewMode: 'Organization' } }),
    );
  });
});

// ─── createAttachment() ───────────────────────────────────────────────────────

describe('SiebelApiService - createAttachment()', () => {
  it('maps attachment data to the correct Siebel payload fields', async () => {
    const httpPut = jest.fn().mockReturnValue(of({ data: {} }));
    const service = await makeModule({ put: httpPut });

    await service.createAttachment('sr-001', {
      fileName: 'consent.pdf',
      fileContent: 'base64encodedcontent',
      fileType: 'pdf',
      description: 'Consent form',
      category: 'Consent',
    });

    expect(httpPut).toHaveBeenCalledWith(
      'https://siebel.example.com/Attachment/Attachment',
      expect.objectContaining({
        'SR Id': 'sr-001',
        FileName: 'consent.pdf',
        'Attachment Id': 'base64encodedcontent',
        FileExt: 'pdf',
        Category: 'Consent',
      }),
      expect.anything(),
    );
  });
});

// ─── createFormAttachment() ───────────────────────────────────────────────────

describe('SiebelApiService - createFormAttachment()', () => {
  it('maps form attachment data to the correct Siebel payload fields', async () => {
    const httpPut = jest.fn().mockReturnValue(of({ data: {} }));
    const service = await makeModule({ put: httpPut });

    await service.createFormAttachment('sr-001', {
      fileName: 'form.json',
      template: 'caregiverForm',
      xmlHierarchy: '<xml/>',
      fileContent: 'base64content',
    });

    expect(httpPut).toHaveBeenCalledWith(
      expect.stringContaining('ICM REST Forms Upsert'),
      expect.objectContaining({
        'SR Id': 'sr-001',
        DocFileName: 'form.json',
        Template: 'caregiverForm',
        'XML Hierarchy': '<xml/>',
        'Doc Attachment Id': 'base64content',
      }),
      expect.anything(),
    );
  });
});

// ─── createProspect() ────────────────────────────────────────────────────────

describe('SiebelApiService - createProspect()', () => {
  it('maps prospect data to the correct Siebel payload fields', async () => {
    const httpPut = jest.fn().mockReturnValue(of({ data: {} }));
    const service = await makeModule({ put: httpPut });

    await service.createProspect({
      ServiceRequestId: 'sr-001',
      IcmBcscDid: 'bcsc-did-001',
      FirstName: 'Jane',
      MiddleName: '',
      LastName: 'Doe',
      DateofBirth: '03/15/1990',
      StreetAddress: '123 Main St',
      City: 'Victoria',
      Prov: 'BC',
      PostalCode: 'V8V 1A1',
      EmailAddress: 'jane@example.com',
      HomePhone: '250-555-0100',
      AlternatePhone: '',
      Gender: 'F',
      Relationship: 'Primary',
      ApplicantFlag: 'Y',
    });

    expect(httpPut).toHaveBeenCalledWith(
      expect.stringContaining('SRProspects'),
      expect.objectContaining({
        'Service Request Id': 'sr-001',
        'ICM BCSC DID': 'bcsc-did-001',
        'First Name': 'Jane',
        'Last Name': 'Doe',
        'Birth Date': '03/15/1990',
        'M/F': 'F',
        'Portal Role': 'Primary',
        'Applicant Flag': 'Y',
      }),
      expect.anything(),
    );
  });
});

// ─── createReProspectActivity() ──────────────────────────────────────────────
/*
describe('SiebelApiService - createReProspectActivity()', () => {
  it('calls PUT /Activities/Activities with the service request ID in the payload', async () => {
    const httpPut = jest.fn().mockReturnValue(of({ data: {} }));
    const service = await makeModule({ put: httpPut });

    await service.createReProspectActivity('sr-001');

    expect(httpPut).toHaveBeenCalledWith(
      expect.stringContaining('/Activities/Activities'),
      expect.objectContaining({
        'SR Id': 'sr-001',
      }),
      expect.anything(),
    );
  });
});
*/
