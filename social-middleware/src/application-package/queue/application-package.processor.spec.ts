import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ApplicationPackageProcessor } from './application-package.processor';
import { ApplicationPackage } from '../schema/application-package.schema';
import { ApplicationPackageService } from '../application-package.service';
import { ApplicationPackageStatus } from '../enums/application-package-status.enum';
import { SubmissionStatus } from '../enums/submission-status.enum';
import { ApplicationFormService } from '../../application-form/services/application-form.service';
import { HouseholdService } from '../../household/services/household.service';
import { UserService } from '../../auth/user.service';
import { SiebelApiService } from '../../siebel/siebel-api.service';
import { ConfigService } from '@nestjs/config';
import { NotificationService } from '../../notifications/services/notification.service';
import { UserUtil } from '../../common/utils/user.util';
import { RelationshipToPrimary } from '../../household/enums/relationship-to-primary.enum';
import { ApplicationFormType } from '../../application-form/enums/application-form-types.enum';
import { ApplicationFormStatus } from '../../application-form/enums/application-form-status.enum';
import { Job } from 'bull';

const createMockJob = <T extends Record<string, unknown>>(
  name: string,
  data: T,
  opts: { attemptsMade?: number; attempts?: number } = {},
) =>
  ({
    id: 'test-job-001',
    name,
    data,
    opts: { attempts: opts.attempts ?? 3 },
    attemptsMade: opts.attemptsMade ?? 0,
    queue: {
      add: jest.fn().mockResolvedValue({}),
      getJobs: jest.fn().mockResolvedValue([]),
    },
  }) as unknown as Job<T>;

describe('ApplicationPackageProcessor', () => {
  let processor: ApplicationPackageProcessor;

  const mockFindOne = jest.fn();
  const mockFindOneAndUpdate = jest.fn();
  const mockUpdateOne = jest.fn();
  const mockFind = jest.fn();

  const mockApplicationPackageModel = {
    findOne: mockFindOne,
    findOneAndUpdate: mockFindOneAndUpdate,
    updateOne: mockUpdateOne,
    find: mockFind,
  };

  const mockApplicationFormService = {
    findAllByApplicationPackageId: jest.fn(),
    findByPackageAndUser: jest.fn(),
    convertFormDataToXml: jest.fn(),
    saveSiebelAttachmentId: jest.fn(),
  };
  const mockApplicationPackageService = {
    submitApplicationPackage: jest.fn(),
  };
  const mockHouseholdService = {
    findAllHouseholdMembers: jest.fn(),
    validateHouseholdCompletion: jest.fn(),
    findPrimaryApplicant: jest.fn(),
    updateHouseholdMember: jest.fn(),
  };
  const mockUserService = {
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const mockSiebelApiService = {
    createServiceRequest: jest.fn(),
    createProspect: jest.fn(),
    createFormAttachment: jest.fn(),
    updateServiceRequestStage: jest.fn(),
  };
  const mockNotificationService = {
    sendReferralRequested: jest.fn(),
  };
  const mockUserUtil = {
    sexToGenderType: jest.fn().mockReturnValue('M'),
  };
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockFindOneAndUpdate.mockResolvedValue({});
    mockUpdateOne.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApplicationPackageProcessor,
        {
          provide: getModelToken(ApplicationPackage.name),
          useValue: mockApplicationPackageModel,
        },
        {
          provide: ApplicationFormService,
          useValue: mockApplicationFormService,
        },
        {
          provide: ApplicationPackageService,
          useValue: mockApplicationPackageService,
        },
        { provide: HouseholdService, useValue: mockHouseholdService },
        { provide: UserService, useValue: mockUserService },
        { provide: SiebelApiService, useValue: mockSiebelApiService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('development') },
        },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: UserUtil, useValue: mockUserUtil },
        {
          provide: 'PinoLogger:ApplicationPackageProcessor',
          useValue: mockLogger,
        },
      ],
    }).compile();

    processor = module.get<ApplicationPackageProcessor>(
      ApplicationPackageProcessor,
    );
  });

  // --- fixtures ---
  const consentPackage = {
    applicationPackageId: 'pkg-001',
    status: ApplicationPackageStatus.CONSENT,
    hasPartner: false,
    hasHousehold: false,
  };

  const primaryApplicant = {
    householdMemberId: 'hm-primary-001',
    relationshipToPrimary: RelationshipToPrimary.Self,
    requireScreening: false,
    screeningInfoProvided: false,
  };

  const completePrimaryForms = [
    {
      householdMemberId: 'hm-primary-001',
      type: ApplicationFormType.ABOUTME,
      status: ApplicationFormStatus.COMPLETE,
    },
    {
      householdMemberId: 'hm-primary-001',
      type: ApplicationFormType.CHILDREN,
      status: ApplicationFormStatus.COMPLETE,
    },
    {
      householdMemberId: 'hm-primary-001',
      type: ApplicationFormType.PLACEMENT,
      status: ApplicationFormStatus.COMPLETE,
    },
    {
      householdMemberId: 'hm-primary-001',
      type: ApplicationFormType.REFERENCES,
      status: ApplicationFormStatus.COMPLETE,
    },
    {
      householdMemberId: 'hm-primary-001',
      type: ApplicationFormType.DISCLOSURECONSENT,
      status: ApplicationFormStatus.COMPLETE,
    },
    {
      householdMemberId: 'hm-primary-001',
      type: ApplicationFormType.PCCCONSENT,
      status: ApplicationFormStatus.COMPLETE,
    },
  ];

  // ─── handleCompletenessCheck ────────────────────────────────────────────────

  describe('handleCompletenessCheck', () => {
    it('returns isComplete: false with DRAFT status when package not found', async () => {
      mockFindOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(null) }),
      });

      const result = await processor.handleCompletenessCheck(
        createMockJob('completeness-check', {
          applicationPackageId: 'pkg-001',
        }),
      );

      expect(result).toEqual({
        isComplete: false,
        status: ApplicationPackageStatus.DRAFT,
      });
    });

    it('returns isComplete: false when package is not in CONSENT status', async () => {
      mockFindOne.mockReturnValue({
        lean: () => ({
          exec: () =>
            Promise.resolve({
              ...consentPackage,
              status: ApplicationPackageStatus.APPLICATION,
            }),
        }),
      });

      const result = await processor.handleCompletenessCheck(
        createMockJob('completeness-check', {
          applicationPackageId: 'pkg-001',
        }),
      );

      expect(result).toEqual({
        isComplete: false,
        status: ApplicationPackageStatus.APPLICATION,
      });
    });

    it('returns isComplete: false when no primary applicant found', async () => {
      mockFindOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(consentPackage) }),
      });
      mockApplicationFormService.findAllByApplicationPackageId.mockResolvedValue(
        [],
      );
      mockHouseholdService.findAllHouseholdMembers.mockResolvedValue([]);

      const result = await processor.handleCompletenessCheck(
        createMockJob('completeness-check', {
          applicationPackageId: 'pkg-001',
        }),
      );

      expect(result).toEqual({
        isComplete: false,
        status: ApplicationPackageStatus.CONSENT,
      });
    });

    it('returns isComplete: false when primary applicant has incomplete forms', async () => {
      mockFindOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(consentPackage) }),
      });
      mockHouseholdService.findAllHouseholdMembers.mockResolvedValue([
        primaryApplicant,
      ]);
      mockApplicationFormService.findAllByApplicationPackageId.mockResolvedValue(
        [
          {
            householdMemberId: 'hm-primary-001',
            type: ApplicationFormType.ABOUTME,
            status: ApplicationFormStatus.DRAFT,
          },
        ],
      );

      const result = await processor.handleCompletenessCheck(
        createMockJob('completeness-check', {
          applicationPackageId: 'pkg-001',
        }),
      );

      expect(result).toEqual({
        isComplete: false,
        status: ApplicationPackageStatus.CONSENT,
      });
    });

    it('returns isComplete: false when household validation fails', async () => {
      mockFindOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(consentPackage) }),
      });
      mockHouseholdService.findAllHouseholdMembers.mockResolvedValue([
        primaryApplicant,
      ]);
      mockApplicationFormService.findAllByApplicationPackageId.mockResolvedValue(
        completePrimaryForms,
      );
      mockHouseholdService.validateHouseholdCompletion.mockResolvedValue({
        isComplete: false,
      });

      const result = await processor.handleCompletenessCheck(
        createMockJob('completeness-check', {
          applicationPackageId: 'pkg-001',
        }),
      );

      expect(result).toEqual({
        isComplete: false,
        status: ApplicationPackageStatus.CONSENT,
      });
    });

    it('returns isComplete: false when a screening member has not provided info', async () => {
      const screeningMember = {
        householdMemberId: 'hm-002',
        relationshipToPrimary: 'Spouse' as RelationshipToPrimary,
        requireScreening: true,
        screeningInfoProvided: false,
      };
      mockFindOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(consentPackage) }),
      });
      mockHouseholdService.findAllHouseholdMembers.mockResolvedValue([
        primaryApplicant,
        screeningMember,
      ]);
      mockApplicationFormService.findAllByApplicationPackageId.mockResolvedValue(
        completePrimaryForms,
      );
      mockHouseholdService.validateHouseholdCompletion.mockResolvedValue({
        isComplete: true,
      });

      const result = await processor.handleCompletenessCheck(
        createMockJob('completeness-check', {
          applicationPackageId: 'pkg-001',
        }),
      );

      expect(result).toEqual({
        isComplete: false,
        status: ApplicationPackageStatus.CONSENT,
      });
    });

    it('updates to READY, enqueues submission, and returns isComplete: true when fully complete', async () => {
      const job = createMockJob('completeness-check', {
        applicationPackageId: 'pkg-001',
      });
      mockFindOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(consentPackage) }),
      });
      mockHouseholdService.findAllHouseholdMembers.mockResolvedValue([
        primaryApplicant,
      ]);
      mockApplicationFormService.findAllByApplicationPackageId.mockResolvedValue(
        completePrimaryForms,
      );
      mockHouseholdService.validateHouseholdCompletion.mockResolvedValue({
        isComplete: true,
      });

      const result = await processor.handleCompletenessCheck(job);

      expect(result).toEqual({
        isComplete: true,
        status: ApplicationPackageStatus.READY,
      });
      expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
        { applicationPackageId: 'pkg-001' },
        expect.objectContaining({ status: ApplicationPackageStatus.READY }),
      );

      expect(job.queue.add as jest.Mock).toHaveBeenCalledWith(
        'submission',
        { applicationPackageId: 'pkg-001' },
        expect.any(Object),
      );
    });
  });

  // ─── handleReferralSubmission ────────────────────────────────────────────────

  describe('handleReferralSubmission', () => {
    const referralJobData = {
      applicationPackageId: 'pkg-001',
      userId: 'user-001',
      dto: {
        email: 'jane@example.com',
        home_phone: '604-555-1234',
        alternate_phone: '',
      },
    };

    const mockPackage = {
      _id: 'mongo-id-001',
      applicationPackageId: 'pkg-001',
      userId: 'user-001',
      srId: null,
      subtype: 'FCH',
      subsubtype: 'FCH',
    };

    const mockPrimaryApplicant = {
      householdMemberId: 'hm-primary-001',
      prospectId: null,
      email: 'jane@example.com',
      homePhone: '604-555-1234',
      alternatePhone: '',
    };

    const mockUser = {
      bc_services_card_id: 'BCSC123',
      first_name: 'Jane',
      last_name: 'Doe',
      dateOfBirth: '1990-01-15',
      street_address: '123 Main St',
      city: 'Victoria',
      region: 'BC',
      postal_code: 'V8V 1A1',
      sex: 'F',
    };

    beforeEach(() => {
      mockFindOne.mockReturnValue({ exec: () => Promise.resolve(mockPackage) });
      mockHouseholdService.findPrimaryApplicant.mockResolvedValue(
        mockPrimaryApplicant,
      );
      mockUserService.findOne.mockResolvedValue(mockUser);
      mockUserService.update.mockResolvedValue({});
      mockSiebelApiService.createServiceRequest.mockResolvedValue({
        items: { Id: 'sr-001' },
      });
      mockSiebelApiService.createProspect.mockResolvedValue({
        items: { Id: 'prospect-001' },
      });
      mockSiebelApiService.updateServiceRequestStage.mockResolvedValue({});
      mockHouseholdService.updateHouseholdMember.mockResolvedValue({});
      mockApplicationFormService.findByPackageAndUser.mockResolvedValue([]);
      mockNotificationService.sendReferralRequested.mockResolvedValue({});
    });

    it('returns empty srId when package not found', async () => {
      mockFindOne.mockReturnValue({ exec: () => Promise.resolve(null) });

      const result = await processor.handleReferralSubmission(
        createMockJob('submit-referral', referralJobData),
      );

      expect(result).toEqual({ srId: '' });
      expect(mockSiebelApiService.createServiceRequest).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when primary applicant not found', async () => {
      mockHouseholdService.findPrimaryApplicant.mockResolvedValue(null);

      await expect(
        processor.handleReferralSubmission(
          createMockJob('submit-referral', referralJobData),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates a service request and saves srId when srId does not exist', async () => {
      await processor.handleReferralSubmission(
        createMockJob('submit-referral', referralJobData),
      );

      expect(mockSiebelApiService.createServiceRequest).toHaveBeenCalledTimes(
        1,
      );
      expect(mockUpdateOne).toHaveBeenCalledWith(
        { _id: mockPackage._id },
        { srId: 'sr-001' },
      );
    });

    it('skips service request creation when srId already exists (idempotency)', async () => {
      mockFindOne.mockReturnValue({
        exec: () =>
          Promise.resolve({ ...mockPackage, srId: 'sr-existing-001' }),
      });

      await processor.handleReferralSubmission(
        createMockJob('submit-referral', referralJobData),
      );

      expect(mockSiebelApiService.createServiceRequest).not.toHaveBeenCalled();
    });

    it('throws InternalServerErrorException when Siebel returns no SR ID', async () => {
      mockSiebelApiService.createServiceRequest.mockResolvedValue({
        items: {},
      });

      await expect(
        processor.handleReferralSubmission(
          createMockJob('submit-referral', referralJobData),
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('skips prospect creation when prospectId already exists (idempotency)', async () => {
      mockFindOne.mockReturnValue({
        exec: () => Promise.resolve({ ...mockPackage, srId: 'sr-001' }),
      });
      mockHouseholdService.findPrimaryApplicant.mockResolvedValue({
        ...mockPrimaryApplicant,
        prospectId: 'existing-prospect-001',
      });

      await processor.handleReferralSubmission(
        createMockJob('submit-referral', referralJobData),
      );

      expect(mockSiebelApiService.createProspect).not.toHaveBeenCalled();
    });
  });

  // ─── handleSubmission ───────────────────────────────────────────────────────

  describe('handleSubmission', () => {
    const readyPackage = {
      applicationPackageId: 'pkg-001',
      userId: 'user-001',
      status: ApplicationPackageStatus.READY,
    };

    it('returns success: false when package not found', async () => {
      mockFindOne.mockReturnValue({ exec: () => Promise.resolve(null) });

      const result = await processor.handleSubmission(
        createMockJob('submission', { applicationPackageId: 'pkg-001' }),
      );

      expect(result).toEqual({ success: false });
      expect(
        mockApplicationPackageService.submitApplicationPackage,
      ).not.toHaveBeenCalled();
    });

    it('returns success: false when package is not in READY status', async () => {
      mockFindOne.mockReturnValue({
        exec: () =>
          Promise.resolve({
            ...readyPackage,
            status: ApplicationPackageStatus.CONSENT,
          }),
      });

      const result = await processor.handleSubmission(
        createMockJob('submission', { applicationPackageId: 'pkg-001' }),
      );

      expect(result).toEqual({ success: false });
    });

    it('updates submissionStatus to SUCCESS and returns success: true', async () => {
      mockFindOne.mockReturnValue({
        exec: () => Promise.resolve(readyPackage),
      });
      mockApplicationPackageService.submitApplicationPackage.mockResolvedValue({
        serviceRequestId: 'sr-001',
      });

      const result = await processor.handleSubmission(
        createMockJob('submission', { applicationPackageId: 'pkg-001' }),
      );

      expect(result).toEqual({ success: true, serviceRequestId: 'sr-001' });
      expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
        { applicationPackageId: 'pkg-001' },
        expect.objectContaining({ submissionStatus: SubmissionStatus.SUCCESS }),
      );
    });

    it('updates submissionStatus to ERROR and re-throws on failure', async () => {
      mockFindOne.mockReturnValue({
        exec: () => Promise.resolve(readyPackage),
      });
      mockApplicationPackageService.submitApplicationPackage.mockRejectedValue(
        new Error('Siebel unavailable'),
      );

      await expect(
        processor.handleSubmission(
          createMockJob('submission', { applicationPackageId: 'pkg-001' }),
        ),
      ).rejects.toThrow('Siebel unavailable');

      expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
        { applicationPackageId: 'pkg-001' },
        expect.objectContaining({ submissionStatus: SubmissionStatus.ERROR }),
      );
    });
  });

  // ─── onFailed ────────────────────────────────────────────────────────────────

  describe('onFailed', () => {
    it('marks submission as FAILED when last attempt exhausted', async () => {
      const job = createMockJob(
        'submission',
        { applicationPackageId: 'pkg-001' },
        { attemptsMade: 3, attempts: 3 },
      );

      await processor.onFailed(job as any, new Error('final error'));

      expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
        { applicationPackageId: 'pkg-001' },
        expect.objectContaining({ submissionStatus: SubmissionStatus.FAILED }),
      );
    });

    it('does not mark as FAILED when retries remain', async () => {
      const job = createMockJob(
        'submission',
        { applicationPackageId: 'pkg-001' },
        { attemptsMade: 1, attempts: 3 },
      );

      await processor.onFailed(job as any, new Error('transient error'));

      expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    });
  });
});
