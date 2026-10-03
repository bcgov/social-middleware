import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { AxiosError } from 'axios';
import { PinoLogger } from 'nestjs-pino';
import { of, throwError } from 'rxjs';
import { IcmCaregiverType } from '../enums/icm-caregiver-type.enum';
import {
  SiebelApiError,
  SiebelApiService,
  SiebelCaseContact,
} from '../siebel-api.service';
import { SiebelAuthService } from '../siebel-auth.service';

const mockLogger = {
  setContext: jest.fn(),
  trace: jest.fn(),
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
    const headers = (
      httpGet.mock.calls[0][1] as { headers: Record<string, string> }
    ).headers;
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
  it('queries the case contacts child endpoint with the correct params', async () => {
    const httpGet = jest.fn().mockReturnValue(of({ data: { items: [] } }));
    const service = await makeModule({ get: httpGet });

    await service.getCaseContacts('1-52XHAQJ');

    expect(httpGet).toHaveBeenCalledWith(
      'https://siebel.example.com/Cases/Case/1-52XHAQJ/Contact',
      expect.objectContaining({
        params: {
          ViewMode: 'Organization',
          fields: 'Relationship,Last Name,First Name,End Date',
        },
      }),
    );
  });

  it('returns the items array when present', async () => {
    const contacts: SiebelCaseContact[] = [
      {
        Id: '1-52MIU51',
        Relationship: 'Key player',
        'First Name': 'Molly',
        'Last Name': 'Moore',
        'End Date': '',
      },
    ];
    const httpGet = jest
      .fn()
      .mockReturnValue(of({ data: { items: contacts } }));
    const service = await makeModule({ get: httpGet });

    const result = await service.getCaseContacts('1-52XHAQJ');

    expect(result).toEqual(contacts);
  });

  it('wraps a single contact returned without the items wrapper', async () => {
    const contact = { Id: '1-52MIU51', Relationship: 'Key player' };
    const httpGet = jest.fn().mockReturnValue(of({ data: contact }));
    const service = await makeModule({ get: httpGet });

    const result = await service.getCaseContacts('1-52XHAQJ');

    expect(result).toEqual([contact]);
  });

  it('returns an empty array when the response has no items', async () => {
    const httpGet = jest.fn().mockReturnValue(of({ data: {} }));
    const service = await makeModule({ get: httpGet });

    const result = await service.getCaseContacts('1-52XHAQJ');

    expect(result).toEqual([]);
  });

  it('returns an empty array on 404', async () => {
    const httpGet = jest
      .fn()
      .mockReturnValue(throwError(() => createAxiosError(404)));
    const service = await makeModule({ get: httpGet });

    const result = await service.getCaseContacts('1-52XHAQJ');

    expect(result).toEqual([]);
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

  it('sends the provided fields to the SR endpoint', async () => {
    await service.updateServiceRequestFields('sr-001', {
      'ICM BCSC DID': 'bcsc-did-999',
    });

    expect(httpPut).toHaveBeenCalledWith(
      'https://siebel.example.com/ServiceRequest/ServiceRequest/sr-001',
      { 'ICM BCSC DID': 'bcsc-did-999' },
      expect.objectContaining({ params: { ViewMode: 'Organization' } }),
    );
  });

  it('rethrows errors from the PUT call', async () => {
    httpPut.mockReturnValue(
      throwError(() => createAxiosError(500, { message: 'Siebel error' })),
    );
    await expect(
      service.updateServiceRequestFields('sr-001', { field: 'value' }),
    ).rejects.toThrow('Siebel error');
  });
});

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

// ─── getActiveCaregiverType() ─────────────────────────────────────────────────

describe('SiebelApiService - getActiveCaregiverType()', () => {
  let service: SiebelApiService;
  let httpGet: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSiebelAuthService.getAccessToken.mockResolvedValue('mock-token');
    httpGet = jest.fn();
    service = await makeModule({ get: httpGet });
  });

  it('returns the matching active record', async () => {
    httpGet.mockReturnValue(
      of({
        data: {
          items: [
            {
              Id: 'ct-1',
              'Caregiver Type': 'Prospective Caregiver',
              'End Date': '',
            },
          ],
        },
      }),
    );

    const result = await service.getActiveCaregiverType(
      'contact-001',
      IcmCaregiverType.PROSPECTIVE_CAREGIVER,
    );

    expect(result).toEqual(
      expect.objectContaining({
        Id: 'ct-1',
        'Caregiver Type': 'Prospective Caregiver',
      }),
    );
  });

  it('ignores records with an End Date set', async () => {
    httpGet.mockReturnValue(
      of({
        data: {
          items: [
            {
              Id: 'ct-1',
              'Caregiver Type': 'Prospective Caregiver',
              'End Date': '01/01/2020',
            },
          ],
        },
      }),
    );

    const result = await service.getActiveCaregiverType(
      'contact-001',
      IcmCaregiverType.PROSPECTIVE_CAREGIVER,
    );

    expect(result).toBeNull();
  });

  it('returns null when no record matches the caregiver type', async () => {
    httpGet.mockReturnValue(
      of({
        data: {
          items: [{ Id: 'ct-1', 'Caregiver Type': 'FCH', 'End Date': '' }],
        },
      }),
    );

    const result = await service.getActiveCaregiverType(
      'contact-001',
      IcmCaregiverType.PROSPECTIVE_CAREGIVER,
    );

    expect(result).toBeNull();
  });

  it('returns the first match when multiple active records exist (does not throw)', async () => {
    httpGet.mockReturnValue(
      of({
        data: {
          items: [
            {
              Id: 'ct-1',
              'Caregiver Type': 'Prospective Caregiver',
              'End Date': '',
            },
            {
              Id: 'ct-2',
              'Caregiver Type': 'Prospective Caregiver',
              'End Date': '',
            },
          ],
        },
      }),
    );

    const result = await service.getActiveCaregiverType(
      'contact-001',
      IcmCaregiverType.PROSPECTIVE_CAREGIVER,
    );

    expect(result?.Id).toBe('ct-1');
  });

  it('returns null on 404 (no CaregiverTypes records for contact)', async () => {
    httpGet.mockReturnValue(
      throwError(() => createAxiosError(404, { ERROR: 'no data' })),
    );

    const result = await service.getActiveCaregiverType(
      'contact-001',
      IcmCaregiverType.PROSPECTIVE_CAREGIVER,
    );

    expect(result).toBeNull();
  });

  it('rethrows non-404 errors', async () => {
    httpGet.mockReturnValue(
      throwError(() => createAxiosError(500, { message: 'ICM down' })),
    );

    await expect(
      service.getActiveCaregiverType(
        'contact-001',
        IcmCaregiverType.PROSPECTIVE_CAREGIVER,
      ),
    ).rejects.toThrow('ICM down');
  });
});

// ─── getIcmContactById() ───────────────────────────────────────────────────────

describe('SiebelApiService - getIcmContactById()', () => {
  let service: SiebelApiService;
  let httpGet: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSiebelAuthService.getAccessToken.mockResolvedValue('mock-token');
    httpGet = jest.fn();
    service = await makeModule({ get: httpGet });
  });

  it('returns contact details when found', async () => {
    const contact = {
      Id: 'contact-001',
      'First Name': 'Jane',
      'Last Name': 'Doe',
      'Birth Date': '01/15/1990',
      'Primary Email': 'jane@example.com',
    };
    httpGet.mockReturnValue(of({ data: contact }));

    const result = await service.getIcmContactById('contact-001');

    expect(result).toEqual(contact);
  });

  it('returns null on 404', async () => {
    httpGet.mockReturnValue(
      throwError(() => createAxiosError(404, { ERROR: 'no data' })),
    );

    const result = await service.getIcmContactById('contact-001');

    expect(result).toBeNull();
  });

  it('rethrows non-404 errors', async () => {
    httpGet.mockReturnValue(
      throwError(() => createAxiosError(500, { message: 'ICM down' })),
    );

    await expect(service.getIcmContactById('contact-001')).rejects.toThrow(
      'ICM down',
    );
  });
});

// ─── getNewKinshipSRsForProspectiveCaregivers() ────────────────────────────────

describe('SiebelApiService - getNewKinshipSRsForProspectiveCaregivers()', () => {
  let service: SiebelApiService;
  let httpGet: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSiebelAuthService.getAccessToken.mockResolvedValue('mock-token');
    httpGet = jest.fn();
    service = await makeModule({ get: httpGet });
  });

  it('includes both exclusions in the SearchSpec', async () => {
    httpGet.mockReturnValue(of({ data: { items: [] } }));

    await service.getNewKinshipSRsForProspectiveCaregivers();

    const params = (
      httpGet.mock.calls[0][1] as { params: { SearchSpec: string } }
    ).params;
    expect(params.SearchSpec).toContain("[Primary Contact Id] <> ''");
    expect(params.SearchSpec).toContain(
      "[Primary Contact Id] <> 'No Match Row Id'",
    );
  });

  it('returns only SRs whose contact has an active Prospective Caregiver type', async () => {
    httpGet
      .mockReturnValueOnce(
        of({
          data: {
            items: [
              { Id: 'sr-001', 'Primary Contact Id': 'contact-001' },
              { Id: 'sr-002', 'Primary Contact Id': 'contact-002' },
            ],
          },
        }),
      )
      // first contact: has the caregiver type
      .mockReturnValueOnce(
        of({
          data: {
            items: [
              {
                Id: 'ct-1',
                'Caregiver Type': 'Prospective Caregiver',
                'End Date': '',
              },
            ],
          },
        }),
      )
      // second contact: 404, no caregiver types at all
      .mockReturnValueOnce(
        throwError(() => createAxiosError(404, { ERROR: 'no data' })),
      );

    const result = await service.getNewKinshipSRsForProspectiveCaregivers();

    expect(result).toEqual([
      { Id: 'sr-001', 'Primary Contact Id': 'contact-001' },
    ]);
  });

  it('normalizes a single SR item to an array', async () => {
    httpGet
      .mockReturnValueOnce(
        of({
          data: {
            items: { Id: 'sr-001', 'Primary Contact Id': 'contact-001' },
          },
        }),
      )
      .mockReturnValueOnce(
        of({
          data: {
            items: [
              {
                Id: 'ct-1',
                'Caregiver Type': 'Prospective Caregiver',
                'End Date': '',
              },
            ],
          },
        }),
      );

    const result = await service.getNewKinshipSRsForProspectiveCaregivers();

    expect(result).toHaveLength(1);
    expect(result[0].Id).toBe('sr-001');
  });
});

// ─── get() — 404 log level ──────────────────────────────────────────────────

describe('SiebelApiService - get() 404 logging', () => {
  let service: SiebelApiService;
  let httpGet: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSiebelAuthService.getAccessToken.mockResolvedValue('mock-token');
    httpGet = jest.fn();
    service = await makeModule({ get: httpGet });
  });

  it('logs 404s at debug level, not error', async () => {
    httpGet.mockReturnValue(
      throwError(() => createAxiosError(404, { ERROR: 'no data' })),
    );

    await expect(service.get('/endpoint')).rejects.toThrow();

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: '/endpoint' }),
      expect.stringContaining('404'),
    );
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('still logs non-404 errors at error level', async () => {
    httpGet.mockReturnValue(
      throwError(() => createAxiosError(500, { message: 'ICM down' })),
    );

    await expect(service.get('/endpoint')).rejects.toThrow();

    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('throws a SiebelApiError carrying the HTTP status', async () => {
    httpGet.mockReturnValue(
      throwError(() => createAxiosError(404, { ERROR: 'no data' })),
    );

    await expect(service.get('/endpoint')).rejects.toThrow(SiebelApiError);
    await expect(service.get('/endpoint')).rejects.toMatchObject({
      status: 404,
    });
  });
});
