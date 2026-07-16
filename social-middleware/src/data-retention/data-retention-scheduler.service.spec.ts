import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { DataRetentionSchedulerService } from './data-retention-scheduler.service';
import { FormParameters } from '../application-form/schemas/form-parameters.schema';
import { ScreeningAccessCode } from '../household/schemas/screening-access-code.schema';
import { ApplicationPackage } from 'src/application-package/schema/application-package.schema';
import { HouseholdMembers } from 'src/household/schemas/household-members.schema';
import { ApplicationForm } from 'src/application-form/schemas/application-form.schema';
import { Attachment } from 'src/attachments/schemas/attachment.schema';
import { ServiceRequestStage } from 'src/application-package/enums/application-package-status.enum';
import { getLoggerToken } from 'nestjs-pino';

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  setContext: jest.fn(),
};

const deleteResult = (count: number) =>
  Promise.resolve({ deletedCount: count });

// ─── purgeStaleRecords ────────────────────────────────────────────────────────

describe('DataRetentionSchedulerService - purgeStaleRecords', () => {
  let service: DataRetentionSchedulerService;

  const mockFormParametersDeleteMany = jest.fn();
  const mockScreeningAccessCodeDeleteMany = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataRetentionSchedulerService,
        {
          provide: getLoggerToken(DataRetentionSchedulerService.name),
          useValue: mockLogger,
        },
        {
          provide: getModelToken(FormParameters.name),
          useValue: { deleteMany: mockFormParametersDeleteMany },
        },
        {
          provide: getModelToken(ScreeningAccessCode.name),
          useValue: { deleteMany: mockScreeningAccessCodeDeleteMany },
        },
        { provide: getModelToken(ApplicationPackage.name), useValue: {} },
        { provide: getModelToken(HouseholdMembers.name), useValue: {} },
        { provide: getModelToken(ApplicationForm.name), useValue: {} },
        { provide: getModelToken(Attachment.name), useValue: {} },
      ],
    }).compile();

    service = module.get<DataRetentionSchedulerService>(
      DataRetentionSchedulerService,
    );
  });

  it('deletes FormParameters older than 24 hours', async () => {
    mockFormParametersDeleteMany.mockReturnValue(deleteResult(0));
    mockScreeningAccessCodeDeleteMany.mockReturnValue(deleteResult(0));

    const before = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await service.purgeStaleRecords();
    const after = new Date(Date.now() - 24 * 60 * 60 * 1000);

    expect(mockFormParametersDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ createdAt: { $lt: expect.any(Date) } }),
    );

    const cutoff: Date =
      mockFormParametersDeleteMany.mock.calls[0][0].createdAt.$lt;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(cutoff.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('deletes ScreeningAccessCodes that are used and older than 30 days', async () => {
    mockFormParametersDeleteMany.mockReturnValue(deleteResult(0));
    mockScreeningAccessCodeDeleteMany.mockReturnValue(deleteResult(0));

    await service.purgeStaleRecords();

    expect(mockScreeningAccessCodeDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        createdAt: { $lt: expect.any(Date) },
        isUsed: true,
      }),
    );
  });

  it('logs when records are deleted', async () => {
    mockFormParametersDeleteMany.mockReturnValue(deleteResult(5));
    mockScreeningAccessCodeDeleteMany.mockReturnValue(deleteResult(0));

    await service.purgeStaleRecords();

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'FormParameters',
        deletedCount: 5,
      }),
      'Data retention purge complete',
    );
  });

  it('does not log when nothing was deleted', async () => {
    mockFormParametersDeleteMany.mockReturnValue(deleteResult(0));
    mockScreeningAccessCodeDeleteMany.mockReturnValue(deleteResult(0));

    await service.purgeStaleRecords();

    expect(mockLogger.info).not.toHaveBeenCalled();
  });
});

// ─── purgeCompletedPackages ───────────────────────────────────────────────────

describe('DataRetentionSchedulerService - purgeCompletedPackages', () => {
  let service: DataRetentionSchedulerService;

  const mockDeleteMany = jest.fn();
  const mockLean = jest.fn();
  const mockLimit = jest.fn().mockReturnValue({ lean: mockLean });
  const mockSelect = jest.fn().mockReturnValue({ limit: mockLimit });
  const mockFind = jest.fn().mockReturnValue({ select: mockSelect });

  const stalePackages = [
    { applicationPackageId: 'pkg-001' },
    { applicationPackageId: 'pkg-002' },
  ];

  beforeEach(async () => {
    jest.clearAllMocks();
    mockLimit.mockReturnValue({ lean: mockLean });
    mockSelect.mockReturnValue({ limit: mockLimit });
    mockFind.mockReturnValue({ select: mockSelect });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataRetentionSchedulerService,
        {
          provide: getLoggerToken(DataRetentionSchedulerService.name),
          useValue: mockLogger,
        },
        { provide: getModelToken(FormParameters.name), useValue: {} },
        {
          provide: getModelToken(ScreeningAccessCode.name),
          useValue: { deleteMany: mockDeleteMany },
        },
        {
          provide: getModelToken(ApplicationPackage.name),
          useValue: { find: mockFind, deleteMany: mockDeleteMany },
        },
        {
          provide: getModelToken(HouseholdMembers.name),
          useValue: { deleteMany: mockDeleteMany },
        },
        {
          provide: getModelToken(ApplicationForm.name),
          useValue: { deleteMany: mockDeleteMany },
        },
        {
          provide: getModelToken(Attachment.name),
          useValue: { deleteMany: mockDeleteMany },
        },
      ],
    }).compile();

    service = module.get<DataRetentionSchedulerService>(
      DataRetentionSchedulerService,
    );
  });

  it('returns early when no completed packages are found', async () => {
    mockLean.mockResolvedValue([]);

    await service.purgeCompletedPackages();

    expect(mockDeleteMany).not.toHaveBeenCalled();
    expect(mockLogger.info).not.toHaveBeenCalled();
  });

  it('queries for packages with srStage Completed and updatedAt before the cutoff', async () => {
    mockLean.mockResolvedValue([]);

    const before = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await service.purgeCompletedPackages();
    const after = new Date(Date.now() - 24 * 60 * 60 * 1000);

    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({
        srStage: ServiceRequestStage.COMPLETED,
        updatedAt: { $lt: expect.any(Date) },
      }),
    );

    const cutoff: Date = mockFind.mock.calls[0][0].updatedAt.$lt;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(cutoff.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('limits the query to 100 results', async () => {
    mockLean.mockResolvedValue([]);

    await service.purgeCompletedPackages();

    expect(mockLimit).toHaveBeenCalledWith(100);
  });

  it('deletes all related records for the found packages', async () => {
    mockLean.mockResolvedValue(stalePackages);
    mockDeleteMany.mockReturnValue(deleteResult(2));

    await service.purgeCompletedPackages();

    const expectedQuery = {
      applicationPackageId: { $in: ['pkg-001', 'pkg-002'] },
    };

    expect(mockDeleteMany).toHaveBeenCalledWith(expectedQuery);
    expect(mockDeleteMany).toHaveBeenCalledTimes(5); // forms, members, accessCodes, attachments, packages
  });

  it('logs the deletion counts when packages are removed', async () => {
    mockLean.mockResolvedValue(stalePackages);
    mockDeleteMany.mockReturnValue(deleteResult(2));

    await service.purgeCompletedPackages();

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ packageCount: 2 }),
      'Completed package cascade purge complete',
    );
  });

  it('does not log when no packages were deleted', async () => {
    mockLean.mockResolvedValue(stalePackages);
    mockDeleteMany.mockReturnValue(deleteResult(0));

    await service.purgeCompletedPackages();

    expect(mockLogger.info).not.toHaveBeenCalled();
  });
});

// ─── purgeAbandonedPackages ───────────────────────────────────────────────────

describe('DataRetentionSchedulerService - purgeAbandonedPackages', () => {
  let service: DataRetentionSchedulerService;

  const mockDeleteMany = jest.fn();
  const mockLean = jest.fn();
  const mockLimit = jest.fn().mockReturnValue({ lean: mockLean });
  const mockSelect = jest.fn().mockReturnValue({ limit: mockLimit });
  const mockFind = jest.fn().mockReturnValue({ select: mockSelect });

  const stalePackages = [
    { applicationPackageId: 'pkg-003' },
    { applicationPackageId: 'pkg-004' },
  ];

  beforeEach(async () => {
    jest.clearAllMocks();
    mockLimit.mockReturnValue({ lean: mockLean });
    mockSelect.mockReturnValue({ limit: mockLimit });
    mockFind.mockReturnValue({ select: mockSelect });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataRetentionSchedulerService,
        {
          provide: getLoggerToken(DataRetentionSchedulerService.name),
          useValue: mockLogger,
        },
        { provide: getModelToken(FormParameters.name), useValue: {} },
        {
          provide: getModelToken(ScreeningAccessCode.name),
          useValue: { deleteMany: mockDeleteMany },
        },
        {
          provide: getModelToken(ApplicationPackage.name),
          useValue: { find: mockFind, deleteMany: mockDeleteMany },
        },
        {
          provide: getModelToken(HouseholdMembers.name),
          useValue: { deleteMany: mockDeleteMany },
        },
        {
          provide: getModelToken(ApplicationForm.name),
          useValue: { deleteMany: mockDeleteMany },
        },
        { provide: getModelToken(Attachment.name), useValue: {} },
      ],
    }).compile();

    service = module.get<DataRetentionSchedulerService>(
      DataRetentionSchedulerService,
    );
  });

  it('returns early when no abandoned packages are found', async () => {
    mockLean.mockResolvedValue([]);

    await service.purgeAbandonedPackages();

    expect(mockDeleteMany).not.toHaveBeenCalled();
    expect(mockLogger.info).not.toHaveBeenCalled();
  });

  it('queries for packages missing srId and older than 6 months', async () => {
    mockLean.mockResolvedValue([]);

    await service.purgeAbandonedPackages();

    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: [{ srId: { $exists: false } }, { srId: null }, { srId: '' }],
        createdAt: { $lt: expect.any(Date) },
      }),
    );

    const cutoff: Date = mockFind.mock.calls[0][0].createdAt.$lt;
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    expect(cutoff.getTime()).toBeCloseTo(sixMonthsAgo.getTime(), -3);
  });

  it('limits the query to 100 results', async () => {
    mockLean.mockResolvedValue([]);

    await service.purgeAbandonedPackages();

    expect(mockLimit).toHaveBeenCalledWith(100);
  });

  it('deletes all related records for the found packages', async () => {
    mockLean.mockResolvedValue(stalePackages);
    mockDeleteMany.mockReturnValue(deleteResult(2));

    await service.purgeAbandonedPackages();

    const expectedQuery = {
      applicationPackageId: { $in: ['pkg-003', 'pkg-004'] },
    };

    expect(mockDeleteMany).toHaveBeenCalledWith(expectedQuery);
    expect(mockDeleteMany).toHaveBeenCalledTimes(4); // forms, members, accessCodes, packages
  });

  it('logs the deletion counts', async () => {
    mockLean.mockResolvedValue(stalePackages);
    mockDeleteMany.mockReturnValue(deleteResult(2));

    await service.purgeAbandonedPackages();

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ packageCount: 2 }),
      'Abandoned package cascade purge complete',
    );
  });
});
