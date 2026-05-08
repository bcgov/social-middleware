import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  InternalServerErrorException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ApplicationPackageService } from './application-package.service';
import { ApplicationPackage } from './schema/application-package.schema';
import {
  ApplicationPackageStatus,
  ServiceRequestStage,
} from './enums/application-package-status.enum';
import { ApplicationFormType } from '../application-form/enums/application-form-types.enum';
import { ApplicationFormService } from '../application-form/services/application-form.service';
import { HouseholdService } from '../household/services/household.service';
import { NotificationService } from '../notifications/services/notification.service';
import { AccessCodeService } from '../household/services/access-code.service';
import { UserService } from '../auth/user.service';
import { UserUtil } from '../common/utils/user.util';
import { ApplicationPackageQueueService } from './queue/application-package-queue.service';
import {
  ApplicationPackageSubSubType,
  ApplicationPackageSubType,
} from './enums/application-package-subtypes.enum';
import { CreateApplicationPackageDto } from './dto/create-application-package.dto';
import { RelationshipToPrimary } from '../household/enums/relationship-to-primary.enum';
import { AttachmentsService } from '../attachments/attachments.service';
import { SiebelApiService } from '../siebel/siebel-api.service';
import { ConfigService } from '@nestjs/config';

describe('ApplicationPackageService - updateApplicationPackageStage', () => {
  let service: ApplicationPackageService;

  // --- mock dependencies ---
  const mockFindOneAndUpdate = jest.fn();
  const mockApplicationPackageModel = {
    findOneAndUpdate: mockFindOneAndUpdate,
  };

  const mockApplicationFormService = {
    getApplicationFormByHouseholdId: jest.fn(),
    createApplicationForm: jest.fn(),
  };

  const mockHouseholdService = {
    findPrimaryApplicant: jest.fn(),
  };

  const mockNotificationService = {
    sendApplicationReady: jest.fn(),
    sendApplicationSubmitted: jest.fn(),
  };

  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn(),
  };

  // --- test fixtures ---
  const mockPrimaryApplicant = {
    householdMemberId: 'hm-primary-001',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane.doe@example.com',
  };

  const mockApplicationPackage: Partial<ApplicationPackage> = {
    applicationPackageId: 'pkg-001',
    userId: 'user-001',
    srStage: ServiceRequestStage.REFERRAL,
    status: ApplicationPackageStatus.REFERRAL,
  };

  const mockUpdatedPackage = {
    ...mockApplicationPackage,
    srStage: ServiceRequestStage.APPLICATION,
    status: ApplicationPackageStatus.APPLICATION,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default: findOneAndUpdate returns updated package
    mockFindOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockUpdatedPackage),
      }),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApplicationPackageService,
        {
          provide: getModelToken(ApplicationPackage.name),
          useValue: mockApplicationPackageModel,
        },
        {
          provide: 'ApplicationFormService',
          useValue: mockApplicationFormService,
        },
        { provide: HouseholdService, useValue: mockHouseholdService },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: AccessCodeService, useValue: {} },
        { provide: UserService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: SiebelApiService, useValue: {} },
        { provide: UserUtil, useValue: {} },
        { provide: ApplicationPackageQueueService, useValue: {} },
        { provide: AttachmentsService, useValue: {} },
        { provide: 'PinoLogger:ApplicationFormService', useValue: mockLogger },
        {
          provide: ApplicationFormService,
          useValue: mockApplicationFormService,
        },
        {
          provide: HouseholdService,
          useValue: mockHouseholdService,
        },
      ],
    }).compile();

    service = module.get<ApplicationPackageService>(ApplicationPackageService);
  });

  describe('APPLICATION stage transition', () => {
    it('creates all 7 application forms when transitioning from REFERRAL and no forms exist', async () => {
      mockHouseholdService.findPrimaryApplicant.mockResolvedValue(
        mockPrimaryApplicant,
      );
      mockApplicationFormService.getApplicationFormByHouseholdId.mockResolvedValue(
        [],
      );
      mockApplicationFormService.createApplicationForm.mockResolvedValue({
        applicationFormId: 'form-001',
      });

      await service.updateApplicationPackageStage(
        mockApplicationPackage as ApplicationPackage,
        ServiceRequestStage.APPLICATION,
      );

      expect(
        mockApplicationFormService.createApplicationForm,
      ).toHaveBeenCalledTimes(7);

      const createdTypes =
        mockApplicationFormService.createApplicationForm.mock.calls.map(
          (call) => call[0].type,
        );
      expect(createdTypes).toEqual(
        expect.arrayContaining([
          ApplicationFormType.ABOUTME,
          ApplicationFormType.HOUSEHOLD,
          ApplicationFormType.CHILDREN,
          ApplicationFormType.PLACEMENT,
          ApplicationFormType.REFERENCES,
          ApplicationFormType.DISCLOSURECONSENT,
          ApplicationFormType.PCCCONSENT,
        ]),
      );
    });

    it('creates all 7 application forms when transitioning from null srStage', async () => {
      const packageWithNullStage = { ...mockApplicationPackage, srStage: null };
      mockHouseholdService.findPrimaryApplicant.mockResolvedValue(
        mockPrimaryApplicant,
      );
      mockApplicationFormService.getApplicationFormByHouseholdId.mockResolvedValue(
        [],
      );
      mockApplicationFormService.createApplicationForm.mockResolvedValue({
        applicationFormId: 'form-001',
      });

      await service.updateApplicationPackageStage(
        packageWithNullStage as unknown as ApplicationPackage,
        ServiceRequestStage.APPLICATION,
      );

      expect(
        mockApplicationFormService.createApplicationForm,
      ).toHaveBeenCalledTimes(7);
    });

    it('skips form creation if ABOUTME form already exists (idempotency)', async () => {
      mockHouseholdService.findPrimaryApplicant.mockResolvedValue(
        mockPrimaryApplicant,
      );
      mockApplicationFormService.getApplicationFormByHouseholdId.mockResolvedValue(
        [
          {
            type: ApplicationFormType.ABOUTME,
            applicationFormId: 'existing-form-001',
          },
        ],
      );

      await service.updateApplicationPackageStage(
        mockApplicationPackage as ApplicationPackage,
        ServiceRequestStage.APPLICATION,
      );

      expect(
        mockApplicationFormService.createApplicationForm,
      ).not.toHaveBeenCalled();
    });

    it('skips notification if forms already exist (idempotency)', async () => {
      mockHouseholdService.findPrimaryApplicant.mockResolvedValue(
        mockPrimaryApplicant,
      );
      mockApplicationFormService.getApplicationFormByHouseholdId.mockResolvedValue(
        [
          {
            type: ApplicationFormType.ABOUTME,
            applicationFormId: 'existing-form-001',
          },
        ],
      );

      await service.updateApplicationPackageStage(
        mockApplicationPackage as ApplicationPackage,
        ServiceRequestStage.APPLICATION,
      );

      expect(
        mockNotificationService.sendApplicationReady,
      ).not.toHaveBeenCalled();
    });

    it('sends the application-ready notification on first transition', async () => {
      mockHouseholdService.findPrimaryApplicant.mockResolvedValue(
        mockPrimaryApplicant,
      );
      mockApplicationFormService.getApplicationFormByHouseholdId.mockResolvedValue(
        [],
      );
      mockApplicationFormService.createApplicationForm.mockResolvedValue({
        applicationFormId: 'form-001',
      });

      await service.updateApplicationPackageStage(
        mockApplicationPackage as ApplicationPackage,
        ServiceRequestStage.APPLICATION,
      );

      expect(
        mockNotificationService.sendApplicationReady,
      ).toHaveBeenCalledTimes(1);
      expect(mockNotificationService.sendApplicationReady).toHaveBeenCalledWith(
        mockPrimaryApplicant.email,
        'Jane Doe',
      );
    });

    it('sets package status to APPLICATION', async () => {
      mockHouseholdService.findPrimaryApplicant.mockResolvedValue(
        mockPrimaryApplicant,
      );
      mockApplicationFormService.getApplicationFormByHouseholdId.mockResolvedValue(
        [],
      );
      mockApplicationFormService.createApplicationForm.mockResolvedValue({
        applicationFormId: 'form-001',
      });

      await service.updateApplicationPackageStage(
        mockApplicationPackage as ApplicationPackage,
        ServiceRequestStage.APPLICATION,
      );

      expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
        { applicationPackageId: mockApplicationPackage.applicationPackageId },
        expect.objectContaining({
          srStage: ServiceRequestStage.APPLICATION,
          status: ApplicationPackageStatus.APPLICATION,
        }),
        { new: true },
      );
    });
  });

  describe('SCREENING stage transition', () => {
    it('does not create forms on SCREENING transition', async () => {
      const submittedPackage = {
        ...mockApplicationPackage,
        srStage: ServiceRequestStage.APPLICATION,
      };
      mockHouseholdService.findPrimaryApplicant.mockResolvedValue(
        mockPrimaryApplicant,
      );
      mockFindOneAndUpdate.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            ...mockUpdatedPackage,
            srStage: ServiceRequestStage.SCREENING,
          }),
        }),
      });

      await service.updateApplicationPackageStage(
        submittedPackage as ApplicationPackage,
        ServiceRequestStage.SCREENING,
      );

      expect(
        mockApplicationFormService.createApplicationForm,
      ).not.toHaveBeenCalled();
    });

    it('sets package status to SUBMITTED on SCREENING transition', async () => {
      const submittedPackage = {
        ...mockApplicationPackage,
        srStage: ServiceRequestStage.APPLICATION,
      };
      mockHouseholdService.findPrimaryApplicant.mockResolvedValue(
        mockPrimaryApplicant,
      );
      mockFindOneAndUpdate.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            ...mockUpdatedPackage,
            srStage: ServiceRequestStage.SCREENING,
          }),
        }),
      });

      await service.updateApplicationPackageStage(
        submittedPackage as ApplicationPackage,
        ServiceRequestStage.SCREENING,
      );

      expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
        { applicationPackageId: mockApplicationPackage.applicationPackageId },
        expect.objectContaining({
          srStage: ServiceRequestStage.SCREENING,
          status: ApplicationPackageStatus.SUBMITTED,
        }),
        { new: true },
      );
    });

    it('sends application-submitted notification on SCREENING transition', async () => {
      const submittedPackage = {
        ...mockApplicationPackage,
        srStage: ServiceRequestStage.APPLICATION,
      };
      mockHouseholdService.findPrimaryApplicant.mockResolvedValue(
        mockPrimaryApplicant,
      );
      mockFindOneAndUpdate.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            ...mockUpdatedPackage,
            srStage: ServiceRequestStage.SCREENING,
          }),
        }),
      });

      await service.updateApplicationPackageStage(
        submittedPackage as ApplicationPackage,
        ServiceRequestStage.SCREENING,
      );

      expect(
        mockNotificationService.sendApplicationSubmitted,
      ).toHaveBeenCalledWith(mockPrimaryApplicant.email, 'Jane Doe');
    });
  });

  describe('error cases', () => {
    it('throws InternalServerErrorException if primary applicant is not found', async () => {
      mockHouseholdService.findPrimaryApplicant.mockResolvedValue(null);

      await expect(
        service.updateApplicationPackageStage(
          mockApplicationPackage as ApplicationPackage,
          ServiceRequestStage.APPLICATION,
        ),
      ).rejects.toThrow(InternalServerErrorException);

      expect(
        mockApplicationFormService.createApplicationForm,
      ).not.toHaveBeenCalled();
    });

    it('throws NotFoundException if application package is not found in DB', async () => {
      mockHouseholdService.findPrimaryApplicant.mockResolvedValue(
        mockPrimaryApplicant,
      );
      mockApplicationFormService.getApplicationFormByHouseholdId.mockResolvedValue(
        [],
      );
      mockApplicationFormService.createApplicationForm.mockResolvedValue({
        applicationFormId: 'form-001',
      });
      mockFindOneAndUpdate.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      });

      await expect(
        service.updateApplicationPackageStage(
          mockApplicationPackage as ApplicationPackage,
          ServiceRequestStage.APPLICATION,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

describe('ApplicationPackageService - createApplicationPackage', () => {
  let service: ApplicationPackageService;

  const mockSave = jest.fn();

  // Must be a constructor function, not a plain object
  const MockModel = jest.fn().mockImplementation((data) => ({
    ...data,
    save: mockSave,
  }));

  const mockApplicationFormService = {
    createApplicationForm: jest.fn(),
    getApplicationFormByHouseholdId: jest.fn(),
  };
  const mockHouseholdService = {
    createMember: jest.fn(),
    findPrimaryApplicant: jest.fn(),
  };
  const mockUserService = { findOne: jest.fn() };
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn(),
  };

  const mockUser = {
    first_name: 'Jane',
    last_name: 'Doe',
    dateOfBirth: '1990-01-15',
    email: 'jane.doe@example.com',
    sex: 'F',
  };
  const mockCreatedPackage = {
    applicationPackageId: 'pkg-new-001',
    userId: 'user-001',
    status: ApplicationPackageStatus.DRAFT,
  };
  const mockPrimaryMember = {
    householdMemberId: 'hm-primary-001',
  };
  const dto: CreateApplicationPackageDto = {
    subtype: ApplicationPackageSubType.FCH,
    subsubtype: ApplicationPackageSubSubType.FCH,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSave.mockResolvedValue(mockCreatedPackage);
    mockUserService.findOne.mockResolvedValue(mockUser);
    mockHouseholdService.createMember.mockResolvedValue(mockPrimaryMember);
    mockApplicationFormService.createApplicationForm
      .mockResolvedValueOnce({ applicationFormId: 'form-referral-001' })
      .mockResolvedValueOnce({ applicationFormId: 'form-indigenous-001' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApplicationPackageService,
        {
          provide: getModelToken(ApplicationPackage.name),
          useValue: MockModel,
        },
        {
          provide: ApplicationFormService,
          useValue: mockApplicationFormService,
        },
        { provide: AccessCodeService, useValue: {} },
        { provide: HouseholdService, useValue: mockHouseholdService },
        { provide: UserService, useValue: mockUserService },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: SiebelApiService, useValue: {} },
        { provide: UserUtil, useValue: {} },
        { provide: ApplicationPackageQueueService, useValue: {} },
        { provide: NotificationService, useValue: {} },
        { provide: AttachmentsService, useValue: {} },
        { provide: 'PinoLogger:ApplicationFormService', useValue: mockLogger },
      ],
    }).compile();

    service = module.get<ApplicationPackageService>(ApplicationPackageService);
  });

  it('returns the created application package', async () => {
    const result = await service.createApplicationPackage(dto, 'user-001');
    expect(result).toEqual(mockCreatedPackage);
  });

  it('creates the package with DRAFT status', async () => {
    await service.createApplicationPackage(dto, 'user-001');
    expect(MockModel).toHaveBeenCalledWith(
      expect.objectContaining({ status: ApplicationPackageStatus.DRAFT }),
    );
  });

  it('sets userId from the provided parameter', async () => {
    await service.createApplicationPackage(dto, 'user-001');
    expect(MockModel).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-001' }),
    );
  });

  it('creates primary household member with Self relationship and user data', async () => {
    await service.createApplicationPackage(dto, 'user-001');
    expect(mockHouseholdService.createMember).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-001',
        firstName: 'Jane',
        lastName: 'Doe',
        dateOfBirth: '1990-01-15',
        email: 'jane.doe@example.com',
        relationshipToPrimary: RelationshipToPrimary.Self,
      }),
    );
  });

  it('creates exactly 2 forms: REFERRAL and INDIGENOUS', async () => {
    await service.createApplicationPackage(dto, 'user-001');
    expect(
      mockApplicationFormService.createApplicationForm,
    ).toHaveBeenCalledTimes(2);
    const types =
      mockApplicationFormService.createApplicationForm.mock.calls.map(
        (call) => call[0].type,
      );
    expect(types).toEqual([
      ApplicationFormType.REFERRAL,
      ApplicationFormType.INDIGENOUS,
    ]);
  });

  it('throws BadRequestException if userId is not provided', async () => {
    await expect(service.createApplicationPackage(dto, '')).rejects.toThrow(
      BadRequestException,
    );
  });
});
