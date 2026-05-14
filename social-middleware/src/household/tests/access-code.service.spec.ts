import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { InternalServerErrorException } from '@nestjs/common';
import { AccessCodeService } from '../services/access-code.service';
import { ScreeningAccessCode } from '../schemas/screening-access-code.schema';
import { ApplicationPackage } from '../../application-package/schema/application-package.schema';
import { ApplicationForm } from '../../application-form/schemas/application-form.schema';
import { HouseholdService } from '../services/household.service';
import { AccessCodeType } from '../enums/access-code-type.enum';
import { PinoLogger } from 'nestjs-pino';

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  setContext: jest.fn(),
};

const mockHouseholdService = {
  findById: jest.fn(),
  associateUserWithMember: jest.fn(),
  updateMemberWithUserData: jest.fn(),
};

// ─── associateUserWithAccessCode ──────────────────────────────────────────────

describe('AccessCodeService - associateUserWithAccessCode', () => {
  let service: AccessCodeService;

  const mockFindOne = jest.fn();
  const mockFindByIdAndUpdate = jest.fn();
  const mockUpdateOne = jest.fn();
  const mockUpdateMany = jest.fn();

  const mockScreeningAccessCodeModel = {
    findOne: mockFindOne,
    findByIdAndUpdate: mockFindByIdAndUpdate,
  };

  const validScreeningRecord = {
    _id: 'code-doc-001',
    accessCode: 'ABC123',
    householdMemberId: 'hm-001',
    applicationPackageId: 'pkg-001',
    type: AccessCodeType.SCREENING,
    attemptCount: 0,
  };

  const validNewApplicationRecord = {
    ...validScreeningRecord,
    type: AccessCodeType.NEW_APPLICATION,
    applicationPackageId: 'pkg-new-001',
  };

  const mockHouseholdMember = {
    householdMemberId: 'hm-001',
    firstName: 'Jane',
    lastName: 'Doe',
    dateOfBirth: '1990-01-15',
  };

  const validBcscData = {
    lastName: 'Doe',
    dateOfBirth: '1990-01-15',
    firstName: 'Jane',
    sex: 'F',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockFindByIdAndUpdate.mockResolvedValue({});
    mockUpdateOne.mockResolvedValue({});
    mockUpdateMany.mockResolvedValue({});
    mockHouseholdService.associateUserWithMember.mockResolvedValue({});
    mockHouseholdService.updateMemberWithUserData.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccessCodeService,
        {
          provide: getModelToken(ScreeningAccessCode.name),
          useValue: mockScreeningAccessCodeModel,
        },
        {
          provide: getModelToken(ApplicationPackage.name),
          useValue: { updateOne: mockUpdateOne },
        },
        {
          provide: getModelToken(ApplicationForm.name),
          useValue: { updateMany: mockUpdateMany },
        },
        { provide: HouseholdService, useValue: mockHouseholdService },
        { provide: PinoLogger, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<AccessCodeService>(AccessCodeService);
  });

  describe('when no valid access code record is found', () => {
    it('returns failure', async () => {
      mockFindOne.mockResolvedValue(null);

      const result = await service.associateUserWithAccessCode(
        'INVALID',
        'user-001',
        validBcscData,
      );

      expect(result).toEqual({
        success: false,
        error: 'Invalid or expired access code',
      });
    });
  });

  describe('when household member is not found', () => {
    it('returns failure with no match error', async () => {
      mockFindOne.mockResolvedValue(validScreeningRecord);
      mockHouseholdService.findById.mockResolvedValue(null);

      const result = await service.associateUserWithAccessCode(
        'ABC123',
        'user-001',
        validBcscData,
      );

      expect(result).toEqual({ success: false, error: 'No match' });
    });
  });

  describe('when identity does not match', () => {
    beforeEach(() => {
      mockFindOne.mockResolvedValue(validScreeningRecord);
      mockHouseholdService.findById.mockResolvedValue(mockHouseholdMember);
    });

    it('increments attemptCount and returns failure when last name mismatches', async () => {
      const result = await service.associateUserWithAccessCode(
        'ABC123',
        'user-001',
        { ...validBcscData, lastName: 'Smith' },
      );

      expect(mockFindByIdAndUpdate).toHaveBeenCalledWith(
        validScreeningRecord._id,
        { $inc: { attemptCount: 1 } },
      );
      expect(result).toEqual({
        success: false,
        error: 'Personal information does not match.',
      });
    });

    it('increments attemptCount and returns failure when DOB mismatches', async () => {
      const result = await service.associateUserWithAccessCode(
        'ABC123',
        'user-001',
        { ...validBcscData, dateOfBirth: '1985-06-20' },
      );

      expect(mockFindByIdAndUpdate).toHaveBeenCalledWith(
        validScreeningRecord._id,
        { $inc: { attemptCount: 1 } },
      );
      expect(result).toEqual({
        success: false,
        error: 'Personal information does not match.',
      });
    });

    it('is case-insensitive for last name comparison', async () => {
      const result = await service.associateUserWithAccessCode(
        'ABC123',
        'user-001',
        { ...validBcscData, lastName: 'doe' },
      );

      expect(result.success).toBe(true);
      expect(mockFindByIdAndUpdate).not.toHaveBeenCalledWith(
        validScreeningRecord._id,
        { $inc: { attemptCount: 1 } },
      );
    });
  });

  describe('SCREENING path — successful match', () => {
    beforeEach(() => {
      mockFindOne.mockResolvedValue(validScreeningRecord);
      mockHouseholdService.findById.mockResolvedValue(mockHouseholdMember);
    });

    it('marks the access code as used', async () => {
      await service.associateUserWithAccessCode(
        'ABC123',
        'user-001',
        validBcscData,
      );

      expect(mockFindByIdAndUpdate).toHaveBeenCalledWith(
        validScreeningRecord._id,
        { assignedUserId: 'user-001', isUsed: true },
      );
    });

    it('associates the user with the household member', async () => {
      await service.associateUserWithAccessCode(
        'ABC123',
        'user-001',
        validBcscData,
      );

      expect(mockHouseholdService.associateUserWithMember).toHaveBeenCalledWith(
        'hm-001',
        'user-001',
      );
    });

    it('updates the household member with BCSC data', async () => {
      await service.associateUserWithAccessCode(
        'ABC123',
        'user-001',
        validBcscData,
      );

      expect(
        mockHouseholdService.updateMemberWithUserData,
      ).toHaveBeenCalledWith('hm-001', { firstName: 'Jane', sex: 'F' });
    });

    it('associates application forms with the user', async () => {
      await service.associateUserWithAccessCode(
        'ABC123',
        'user-001',
        validBcscData,
      );

      expect(mockUpdateMany).toHaveBeenCalledWith(
        { householdMemberId: 'hm-001' },
        { userId: 'user-001' },
      );
    });

    it('returns success with householdMemberId', async () => {
      const result = await service.associateUserWithAccessCode(
        'ABC123',
        'user-001',
        validBcscData,
      );

      expect(result).toEqual({ success: true, householdMemberId: 'hm-001' });
    });

    it('does not update the application package', async () => {
      await service.associateUserWithAccessCode(
        'ABC123',
        'user-001',
        validBcscData,
      );

      expect(mockUpdateOne).not.toHaveBeenCalled();
    });
  });

  describe('NEW_APPLICATION path — successful match', () => {
    beforeEach(() => {
      mockFindOne.mockResolvedValue(validNewApplicationRecord);
      mockHouseholdService.findById.mockResolvedValue(mockHouseholdMember);
    });

    it('marks the access code as used', async () => {
      await service.associateUserWithAccessCode(
        'ABC123',
        'user-001',
        validBcscData,
      );

      expect(mockFindByIdAndUpdate).toHaveBeenCalledWith(
        validNewApplicationRecord._id,
        { assignedUserId: 'user-001', isUsed: true },
      );
    });

    it('associates the user with the household member', async () => {
      await service.associateUserWithAccessCode(
        'ABC123',
        'user-001',
        validBcscData,
      );

      expect(mockHouseholdService.associateUserWithMember).toHaveBeenCalledWith(
        'hm-001',
        'user-001',
      );
    });

    it('sets userId on the application package', async () => {
      await service.associateUserWithAccessCode(
        'ABC123',
        'user-001',
        validBcscData,
      );

      expect(mockUpdateOne).toHaveBeenCalledWith(
        { applicationPackageId: 'pkg-new-001' },
        { userId: 'user-001' },
      );
    });

    it('returns success with type and applicationPackageId', async () => {
      const result = await service.associateUserWithAccessCode(
        'ABC123',
        'user-001',
        validBcscData,
      );

      expect(result).toEqual({
        success: true,
        type: AccessCodeType.NEW_APPLICATION,
        applicationPackageId: 'pkg-new-001',
      });
    });

    it('does not update the household member with BCSC data', async () => {
      await service.associateUserWithAccessCode(
        'ABC123',
        'user-001',
        validBcscData,
      );

      expect(
        mockHouseholdService.updateMemberWithUserData,
      ).not.toHaveBeenCalled();
    });

    it('does not update application forms', async () => {
      await service.associateUserWithAccessCode(
        'ABC123',
        'user-001',
        validBcscData,
      );

      expect(mockUpdateMany).not.toHaveBeenCalled();
    });
  });
});

// ─── createAccessCode ─────────────────────────────────────────────────────────

describe('AccessCodeService - createAccessCode', () => {
  let service: AccessCodeService;

  const mockSave = jest.fn();
  const MockScreeningAccessCodeModel = jest.fn().mockImplementation(() => ({
    save: mockSave,
  }));

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSave.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccessCodeService,
        {
          provide: getModelToken(ScreeningAccessCode.name),
          useValue: MockScreeningAccessCodeModel,
        },
        { provide: getModelToken(ApplicationPackage.name), useValue: {} },
        { provide: getModelToken(ApplicationForm.name), useValue: {} },
        { provide: HouseholdService, useValue: mockHouseholdService },
        { provide: PinoLogger, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<AccessCodeService>(AccessCodeService);
  });

  it('returns a 6-character access code and an expiresAt date', async () => {
    const result = await service.createAccessCode('hm-001');

    expect(result.accessCode).toHaveLength(6);
    expect(result.expiresAt).toBeInstanceOf(Date);
  });

  it('defaults to SCREENING type with a 72-hour expiry', async () => {
    const before = Date.now();
    const result = await service.createAccessCode('hm-001');
    const after = Date.now();

    const expectedMs = 72 * 60 * 60 * 1000;
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + expectedMs,
    );
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(after + expectedMs);
  });

  it('sets a 72-hour expiry for SCREENING type', async () => {
    const before = Date.now();
    const result = await service.createAccessCode(
      'hm-001',
      'pkg-001',
      AccessCodeType.SCREENING,
    );
    const after = Date.now();

    const expectedMs = 72 * 60 * 60 * 1000;
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + expectedMs,
    );
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(after + expectedMs);
  });

  it('sets a 336-hour (14-day) expiry for NEW_APPLICATION type', async () => {
    const before = Date.now();
    const result = await service.createAccessCode(
      'hm-001',
      'pkg-001',
      AccessCodeType.NEW_APPLICATION,
    );
    const after = Date.now();

    const expectedMs = 336 * 60 * 60 * 1000;
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + expectedMs,
    );
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(after + expectedMs);
  });

  it('throws InternalServerErrorException if save fails', async () => {
    mockSave.mockRejectedValue(new Error('DB error'));

    await expect(
      service.createAccessCode('hm-001', 'pkg-001', AccessCodeType.SCREENING),
    ).rejects.toThrow(InternalServerErrorException);
  });
});
