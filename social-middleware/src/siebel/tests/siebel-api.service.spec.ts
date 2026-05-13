import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { AxiosError } from 'axios';
import { SiebelApiService } from '../siebel-api.service';
import { SiebelAuthService } from '../siebel-auth.service';
import { PinoLogger } from 'nestjs-pino';

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
