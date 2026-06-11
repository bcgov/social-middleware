import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  InternalServerErrorException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ApplicationPackageService } from '../services/application-package.service';
import { ApplicationPackage } from '../schema/application-package.schema';
import {
  ApplicationPackageStatus,
  ServiceRequestStage,
} from '../enums/application-package-status.enum';
import { ApplicationFormType } from '../../application-form/enums/application-form-types.enum';
import { ApplicationFormService } from '../../application-form/services/application-form.service';
import { HouseholdService } from '../../household/services/household.service';
import { NotificationService } from '../../notifications/services/notification.service';
import { AccessCodeService } from '../../household/services/access-code.service';
import { UserService } from '../../auth/user.service';
import { UserUtil } from '../../common/utils/user.util';
import { ApplicationPackageQueueService } from '../queue/application-package-queue.service';
import {
  ApplicationPackageSubSubType,
  ApplicationPackageSubType,
} from '../enums/application-package-subtypes.enum';
import { CreateApplicationPackageDto } from '../dto/create-application-package.dto';
import { RelationshipToPrimary } from '../../household/enums/relationship-to-primary.enum';
import { AttachmentsService } from '../../attachments/attachments.service';
import { AttachmentType } from '../../attachments/enums/attachment-types.enum';
import { SiebelApiService } from '../../siebel/siebel-api.service';
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
    subtype: ApplicationPackageSubType.FCH,
    subsubtype: ApplicationPackageSubSubType.FCH,
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
        {
          provide: `PinoLogger:${ApplicationFormService.name}`,
          useValue: mockLogger,
        },
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

      const createdTypes = (
        mockApplicationFormService.createApplicationForm.mock.calls as Array<
          [{ type: string }]
        >
      ).map((call) => call[0].type);
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
  const MockModel = jest
    .fn()
    .mockImplementation((data: Partial<ApplicationPackage>) => ({
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
        {
          provide: `PinoLogger:${ApplicationFormService.name}`,
          useValue: mockLogger,
        },
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
    const types = (
      mockApplicationFormService.createApplicationForm.mock.calls as Array<
        [{ type: string }]
      >
    ).map((call) => call[0].type);
    expect(types).toEqual([
      ApplicationFormType.REFERRAL,
      ApplicationFormType.INDIGENOUS,
    ]);
  });

  it('creates no forms for OOC subtype (no referral recipe)', async () => {
    const oocDto = {
      subtype: ApplicationPackageSubType.OOC,
      subsubtype: ApplicationPackageSubSubType.EFP,
    };
    await service.createApplicationPackage(oocDto, 'user-001');
    expect(
      mockApplicationFormService.createApplicationForm,
    ).not.toHaveBeenCalled();
  });

  it('creates no forms for unknown subtype', async () => {
    const unknownDto = {
      subtype: 'UNKNOWN' as ApplicationPackageSubType,
      subsubtype: ApplicationPackageSubSubType.FCH,
    };
    await service.createApplicationPackage(unknownDto, 'user-001');
    expect(
      mockApplicationFormService.createApplicationForm,
    ).not.toHaveBeenCalled();
  });

  it('throws BadRequestException if userId is not provided', async () => {
    await expect(service.createApplicationPackage(dto, '')).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('ApplicationPackageService - lockApplicationPackage', () => {
  let service: ApplicationPackageService;

  const mockFindOne = jest.fn();
  const mockFindOneAndUpdate = jest.fn();
  const mockApplicationPackageModel = {
    findOne: mockFindOne,
    findOneAndUpdate: mockFindOneAndUpdate,
  };

  const mockHouseholdService = {
    validateHouseholdCompletion: jest.fn(),
    findAllHouseholdMembers: jest.fn(),
    findPrimaryApplicant: jest.fn(),
  };

  const mockApplicationFormService = {
    getApplicationFormByHouseholdId: jest.fn(),
    createApplicationForm: jest.fn(),
    createScreeningFormsAndAccessCode: jest.fn(),
  };

  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn(),
  };

  const APPLICATION_PACKAGE_ID = 'pkg-lock-001';
  const USER_ID = 'user-lock-001';

  const mockPackageInApplication: Partial<ApplicationPackage> = {
    applicationPackageId: APPLICATION_PACKAGE_ID,
    userId: USER_ID,
    status: ApplicationPackageStatus.APPLICATION,
    hasPartner: 'true',
    hasHousehold: 'false',
  };

  const mockSelfMember = {
    householdMemberId: 'hm-self-001',
    relationshipToPrimary: RelationshipToPrimary.Self,
    dateOfBirth: '1990-01-01',
  };

  const mockAdultPartner = {
    householdMemberId: 'hm-partner-001',
    relationshipToPrimary: RelationshipToPrimary.Spouse,
    dateOfBirth: '1985-06-15',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockFindOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockPackageInApplication),
    });

    mockFindOneAndUpdate.mockResolvedValue(mockPackageInApplication);

    mockHouseholdService.validateHouseholdCompletion.mockResolvedValue({
      isComplete: true,
      errors: [],
    });

    mockHouseholdService.findAllHouseholdMembers.mockResolvedValue([
      mockSelfMember,
      mockAdultPartner,
    ]);

    mockApplicationFormService.createScreeningFormsAndAccessCode.mockResolvedValue(
      undefined,
    );
    mockApplicationFormService.getApplicationFormByHouseholdId.mockResolvedValue(
      [],
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApplicationPackageService,
        {
          provide: getModelToken(ApplicationPackage.name),
          useValue: mockApplicationPackageModel,
        },
        {
          provide: ApplicationFormService,
          useValue: mockApplicationFormService,
        },
        { provide: HouseholdService, useValue: mockHouseholdService },
        {
          provide: NotificationService,
          useValue: {
            sendApplicationReady: jest.fn(),
            sendApplicationSubmitted: jest.fn(),
          },
        },
        { provide: AccessCodeService, useValue: {} },
        { provide: UserService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: SiebelApiService, useValue: {} },
        { provide: UserUtil, useValue: {} },
        { provide: ApplicationPackageQueueService, useValue: {} },
        { provide: AttachmentsService, useValue: {} },
        {
          provide: `PinoLogger:${ApplicationFormService.name}`,
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get<ApplicationPackageService>(ApplicationPackageService);
  });

  describe('pre-claim guards', () => {
    it('throws NotFoundException when package is not found or not owned by user', async () => {
      mockFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

      await expect(
        service.lockApplicationPackage(APPLICATION_PACKAGE_ID, USER_ID),
      ).rejects.toThrow(NotFoundException);

      expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    });

    it('returns current status without touching DB when package is not in Application status', async () => {
      mockFindOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          ...mockPackageInApplication,
          status: ApplicationPackageStatus.CONSENT,
        }),
      });

      const result = await service.lockApplicationPackage(
        APPLICATION_PACKAGE_ID,
        USER_ID,
      );

      expect(result).toEqual({ status: ApplicationPackageStatus.CONSENT });
      expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
      expect(
        mockHouseholdService.validateHouseholdCompletion,
      ).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when household validation fails', async () => {
      mockHouseholdService.validateHouseholdCompletion.mockResolvedValue({
        isComplete: false,
        errors: [
          'Partner is required but no spouse/partner/common-law record found',
        ],
      });

      await expect(
        service.lockApplicationPackage(APPLICATION_PACKAGE_ID, USER_ID),
      ).rejects.toThrow(BadRequestException);

      expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('atomic claim', () => {
    it('returns current status when concurrent request already claimed the lock', async () => {
      mockFindOneAndUpdate.mockResolvedValueOnce(null);

      const currentPackage = {
        ...mockPackageInApplication,
        status: ApplicationPackageStatus.CONSENT,
      };
      mockFindOne
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue(mockPackageInApplication),
        })
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue(currentPackage),
        });

      const result = await service.lockApplicationPackage(
        APPLICATION_PACKAGE_ID,
        USER_ID,
      );

      expect(result).toEqual({ status: ApplicationPackageStatus.CONSENT });
    });

    it('throws NotFoundException when package is deleted between claim attempt and status read', async () => {
      mockFindOneAndUpdate.mockResolvedValueOnce(null);

      mockFindOne
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue(mockPackageInApplication),
        })
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue(null),
        });

      await expect(
        service.lockApplicationPackage(APPLICATION_PACKAGE_ID, USER_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('screening required path', () => {
    it('generates the screening workflow and returns Consent status', async () => {
      const generateWorkflow = jest
        .spyOn(service as any, 'generateHousholdScreeningWorkflow')
        .mockResolvedValue(undefined);

      const result = await service.lockApplicationPackage(
        APPLICATION_PACKAGE_ID,
        USER_ID,
      );

      expect(generateWorkflow).toHaveBeenCalledWith(APPLICATION_PACKAGE_ID, [
        mockAdultPartner,
      ]);
      expect(result).toEqual({ status: ApplicationPackageStatus.CONSENT });
    });

    it('does not call submitApplicationPackage when screening is required', async () => {
      jest
        .spyOn(service as any, 'generateHousholdScreeningWorkflow')
        .mockResolvedValue(undefined);
      const submitSpy = jest
        .spyOn(service, 'submitApplicationPackage')
        .mockResolvedValue({ serviceRequestId: 'sr-001', isComplete: true });

      await service.lockApplicationPackage(APPLICATION_PACKAGE_ID, USER_ID);

      expect(submitSpy).not.toHaveBeenCalled();
    });

    it('excludes Self member from screening workflow', async () => {
      const generateWorkflow = jest
        .spyOn(service as any, 'generateHousholdScreeningWorkflow')
        .mockResolvedValue(undefined);

      await service.lockApplicationPackage(APPLICATION_PACKAGE_ID, USER_ID);

      const passedMembers = generateWorkflow.mock.calls[0][1];
      expect(passedMembers).not.toContainEqual(
        expect.objectContaining({
          relationshipToPrimary: RelationshipToPrimary.Self,
        }),
      );
    });

    it('excludes minor household members from screening workflow', async () => {
      const minorMember = {
        householdMemberId: 'hm-minor-001',
        relationshipToPrimary: RelationshipToPrimary.Child,
        dateOfBirth: new Date(Date.now() - 10 * 365 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split('T')[0],
      };
      mockHouseholdService.findAllHouseholdMembers.mockResolvedValue([
        mockSelfMember,
        mockAdultPartner,
        minorMember,
      ]);

      const generateWorkflow = jest
        .spyOn(service as any, 'generateHousholdScreeningWorkflow')
        .mockResolvedValue(undefined);

      await service.lockApplicationPackage(APPLICATION_PACKAGE_ID, USER_ID);

      const passedMembers = generateWorkflow.mock.calls[0][1];
      expect(passedMembers).not.toContainEqual(
        expect.objectContaining({ householdMemberId: 'hm-minor-001' }),
      );
    });
  });

  describe('no screening required path', () => {
    beforeEach(() => {
      mockFindOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          ...mockPackageInApplication,
          hasPartner: 'false',
          hasHousehold: 'false',
        }),
      });
      mockHouseholdService.findAllHouseholdMembers.mockResolvedValue([
        mockSelfMember,
      ]);
    });

    it('calls submitApplicationPackage and returns Submitted status', async () => {
      const submitSpy = jest
        .spyOn(service, 'submitApplicationPackage')
        .mockResolvedValue({ serviceRequestId: 'sr-001', isComplete: true });

      const result = await service.lockApplicationPackage(
        APPLICATION_PACKAGE_ID,
        USER_ID,
      );

      expect(submitSpy).toHaveBeenCalledWith(APPLICATION_PACKAGE_ID, USER_ID);
      expect(result).toEqual({ status: ApplicationPackageStatus.SUBMITTED });
    });

    it('does not generate the screening workflow', async () => {
      jest
        .spyOn(service, 'submitApplicationPackage')
        .mockResolvedValue({ serviceRequestId: 'sr-001', isComplete: true });

      const generateWorkflow = jest.spyOn(
        service as any,
        'generateHousholdScreeningWorkflow',
      );

      await service.lockApplicationPackage(APPLICATION_PACKAGE_ID, USER_ID);

      expect(generateWorkflow).not.toHaveBeenCalled();
    });
  });

  describe('rollback on error', () => {
    it('resets status to Application and rethrows when screening workflow fails', async () => {
      jest
        .spyOn(service as any, 'generateHousholdScreeningWorkflow')
        .mockRejectedValue(new Error('Screening form creation failed'));

      await expect(
        service.lockApplicationPackage(APPLICATION_PACKAGE_ID, USER_ID),
      ).rejects.toThrow('Screening form creation failed');

      expect(mockFindOneAndUpdate).toHaveBeenLastCalledWith(
        { applicationPackageId: APPLICATION_PACKAGE_ID },
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          $set: expect.objectContaining({
            status: ApplicationPackageStatus.APPLICATION,
          }),
        }),
      );
    });

    it('resets status to Application and rethrows when submitApplicationPackage fails', async () => {
      mockFindOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          ...mockPackageInApplication,
          hasPartner: 'false',
          hasHousehold: 'false',
        }),
      });
      mockHouseholdService.findAllHouseholdMembers.mockResolvedValue([
        mockSelfMember,
      ]);

      jest
        .spyOn(service, 'submitApplicationPackage')
        .mockRejectedValue(new Error('Siebel unavailable'));

      await expect(
        service.lockApplicationPackage(APPLICATION_PACKAGE_ID, USER_ID),
      ).rejects.toThrow('Siebel unavailable');

      expect(mockFindOneAndUpdate).toHaveBeenLastCalledWith(
        { applicationPackageId: APPLICATION_PACKAGE_ID },
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          $set: expect.objectContaining({
            status: ApplicationPackageStatus.APPLICATION,
          }),
        }),
      );
    });
  });
});

describe('ApplicationPackageService - submitDocumentsToICM', () => {
  let service: ApplicationPackageService;

  const APPLICATION_PACKAGE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const HOUSEHOLD_MEMBER_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
  const ATTACHMENT_ID = 'att-001';
  const SR_ID = 'sr-001';
  const USER_ID = 'user-001';

  const mockApplicationPackageModel = {
    findOne: jest.fn(),
  };

  const mockAttachmentsService = {
    findByApplicationPackageId: jest.fn(),
    findById: jest.fn(),
    saveIcmAttachmentId: jest.fn(),
  };

  const mockSiebelApiService = {
    createAttachment: jest.fn(),
  };

  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn(),
  };

  const mockPackage = {
    applicationPackageId: APPLICATION_PACKAGE_ID,
    srId: SR_ID,
    userId: USER_ID,
  };

  const mockPendingAttachment = {
    attachmentId: ATTACHMENT_ID,
    attachmentType: AttachmentType.MEDICAL_ASSESSMENT,
    householdMemberId: HOUSEHOLD_MEMBER_ID,
    icmAttachmentId: null,
    fileName: 'test-file',
    fileType: 'pdf',
  };

  const mockFullAttachment = {
    ...mockPendingAttachment,
    fileData: 'base64encodeddata',
  };

  const makeLeanExec = (value: any) => ({
    lean: () => ({ exec: () => Promise.resolve(value) }),
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    // Wire up all the other required providers to satisfy DI
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApplicationPackageService,
        {
          provide: getModelToken(ApplicationPackage.name),
          useValue: mockApplicationPackageModel,
        },
        { provide: AttachmentsService, useValue: mockAttachmentsService },
        { provide: SiebelApiService, useValue: mockSiebelApiService },
        {
          provide: `PinoLogger:${ApplicationFormService.name}`,
          useValue: mockLogger,
        },
        // Stub out all other deps the service requires
        { provide: ApplicationFormService, useValue: {} },
        { provide: HouseholdService, useValue: {} },
        { provide: NotificationService, useValue: {} },
        { provide: AccessCodeService, useValue: {} },
        { provide: UserService, useValue: {} },
        { provide: UserUtil, useValue: {} },
        { provide: ApplicationPackageQueueService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: getModelToken('ApplicationForm'), useValue: {} },
      ],
    }).compile();

    service = module.get<ApplicationPackageService>(ApplicationPackageService);
  });

  it('throws NotFoundException when application package is not found', async () => {
    mockApplicationPackageModel.findOne = jest
      .fn()
      .mockReturnValue(makeLeanExec(null));

    await expect(
      service.submitDocumentsToICM(
        APPLICATION_PACKAGE_ID,
        HOUSEHOLD_MEMBER_ID,
        AttachmentType.MEDICAL_ASSESSMENT,
        USER_ID,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws BadRequestException when package has no srId', async () => {
    mockApplicationPackageModel.findOne = jest
      .fn()
      .mockReturnValue(makeLeanExec({ ...mockPackage, srId: null }));

    await expect(
      service.submitDocumentsToICM(
        APPLICATION_PACKAGE_ID,
        HOUSEHOLD_MEMBER_ID,
        AttachmentType.MEDICAL_ASSESSMENT,
        USER_ID,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('returns zero attachmentsUploaded when no pending attachments exist', async () => {
    mockApplicationPackageModel.findOne = jest
      .fn()
      .mockReturnValue(makeLeanExec(mockPackage));
    mockAttachmentsService.findByApplicationPackageId.mockResolvedValue([]);

    const result = await service.submitDocumentsToICM(
      APPLICATION_PACKAGE_ID,
      HOUSEHOLD_MEMBER_ID,
      AttachmentType.MEDICAL_ASSESSMENT,
      USER_ID,
    );

    expect(result).toEqual({ success: true, attachmentsUploaded: 0 });
    expect(mockSiebelApiService.createAttachment).not.toHaveBeenCalled();
  });

  it('filters out attachments that already have an icmAttachmentId', async () => {
    mockApplicationPackageModel.findOne = jest
      .fn()
      .mockReturnValue(makeLeanExec(mockPackage));
    mockAttachmentsService.findByApplicationPackageId.mockResolvedValue([
      { ...mockPendingAttachment, icmAttachmentId: 'already-submitted' },
    ]);

    const result = await service.submitDocumentsToICM(
      APPLICATION_PACKAGE_ID,
      HOUSEHOLD_MEMBER_ID,
      AttachmentType.MEDICAL_ASSESSMENT,
      USER_ID,
    );

    expect(result).toEqual({ success: true, attachmentsUploaded: 0 });
  });

  it('filters by householdMemberId — does not submit attachments belonging to other members', async () => {
    mockApplicationPackageModel.findOne = jest
      .fn()
      .mockReturnValue(makeLeanExec(mockPackage));
    mockAttachmentsService.findByApplicationPackageId.mockResolvedValue([
      { ...mockPendingAttachment, householdMemberId: 'other-member-id' },
    ]);

    const result = await service.submitDocumentsToICM(
      APPLICATION_PACKAGE_ID,
      HOUSEHOLD_MEMBER_ID,
      AttachmentType.MEDICAL_ASSESSMENT,
      USER_ID,
    );

    expect(result).toEqual({ success: true, attachmentsUploaded: 0 });
  });

  it('matches null householdMemberId for primary applicant uploads', async () => {
    mockApplicationPackageModel.findOne = jest
      .fn()
      .mockReturnValue(makeLeanExec(mockPackage));
    mockAttachmentsService.findByApplicationPackageId.mockResolvedValue([
      { ...mockPendingAttachment, householdMemberId: null },
    ]);
    mockAttachmentsService.findById.mockResolvedValue({
      ...mockFullAttachment,
      householdMemberId: null,
    });
    mockSiebelApiService.createAttachment.mockResolvedValue({});

    const result = await service.submitDocumentsToICM(
      APPLICATION_PACKAGE_ID,
      null,
      AttachmentType.MEDICAL_ASSESSMENT,
      USER_ID,
    );

    expect(result.attachmentsUploaded).toBe(1);
  });

  it('uploads pending attachments to Siebel with correct category', async () => {
    mockApplicationPackageModel.findOne = jest
      .fn()
      .mockReturnValue(makeLeanExec(mockPackage));
    mockAttachmentsService.findByApplicationPackageId.mockResolvedValue([
      mockPendingAttachment,
    ]);
    mockAttachmentsService.findById.mockResolvedValue(mockFullAttachment);
    mockSiebelApiService.createAttachment.mockResolvedValue({});

    await service.submitDocumentsToICM(
      APPLICATION_PACKAGE_ID,
      HOUSEHOLD_MEMBER_ID,
      AttachmentType.MEDICAL_ASSESSMENT,
      USER_ID,
    );

    expect(mockSiebelApiService.createAttachment).toHaveBeenCalledWith(
      SR_ID,
      expect.objectContaining({
        fileName: mockFullAttachment.fileName,
        fileContent: mockFullAttachment.fileData,
        fileType: mockFullAttachment.fileType,
        category: 'Medical',
        description: AttachmentType.MEDICAL_ASSESSMENT,
      }),
    );
  });

  it('saves icmAttachmentId after successful Siebel upload', async () => {
    mockApplicationPackageModel.findOne = jest
      .fn()
      .mockReturnValue(makeLeanExec(mockPackage));
    mockAttachmentsService.findByApplicationPackageId.mockResolvedValue([
      mockPendingAttachment,
    ]);
    mockAttachmentsService.findById.mockResolvedValue(mockFullAttachment);
    mockSiebelApiService.createAttachment.mockResolvedValue({});

    await service.submitDocumentsToICM(
      APPLICATION_PACKAGE_ID,
      HOUSEHOLD_MEMBER_ID,
      AttachmentType.MEDICAL_ASSESSMENT,
      USER_ID,
    );

    expect(mockAttachmentsService.saveIcmAttachmentId).toHaveBeenCalledWith(
      ATTACHMENT_ID,
      expect.any(String),
    );
  });

  it('skips attachments with no fileData and does not count them', async () => {
    mockApplicationPackageModel.findOne = jest
      .fn()
      .mockReturnValue(makeLeanExec(mockPackage));
    mockAttachmentsService.findByApplicationPackageId.mockResolvedValue([
      mockPendingAttachment,
    ]);
    mockAttachmentsService.findById.mockResolvedValue({
      ...mockFullAttachment,
      fileData: null,
    });

    const result = await service.submitDocumentsToICM(
      APPLICATION_PACKAGE_ID,
      HOUSEHOLD_MEMBER_ID,
      AttachmentType.MEDICAL_ASSESSMENT,
      USER_ID,
    );

    expect(mockSiebelApiService.createAttachment).not.toHaveBeenCalled();
    expect(result.attachmentsUploaded).toBe(0);
  });

  it('continues processing remaining attachments when one upload fails', async () => {
    const secondAttachment = {
      ...mockPendingAttachment,
      attachmentId: 'att-002',
    };
    mockApplicationPackageModel.findOne = jest
      .fn()
      .mockReturnValue(makeLeanExec(mockPackage));
    mockAttachmentsService.findByApplicationPackageId.mockResolvedValue([
      mockPendingAttachment,
      secondAttachment,
    ]);
    mockAttachmentsService.findById
      .mockResolvedValueOnce(mockFullAttachment)
      .mockResolvedValueOnce({
        ...mockFullAttachment,
        attachmentId: 'att-002',
      });
    mockSiebelApiService.createAttachment
      .mockRejectedValueOnce(new Error('Siebel timeout'))
      .mockResolvedValueOnce({});

    const result = await service.submitDocumentsToICM(
      APPLICATION_PACKAGE_ID,
      HOUSEHOLD_MEMBER_ID,
      AttachmentType.MEDICAL_ASSESSMENT,
      USER_ID,
    );

    expect(result.attachmentsUploaded).toBe(1);
    expect(mockAttachmentsService.saveIcmAttachmentId).toHaveBeenCalledTimes(1);
  });

  it('returns the count of successfully uploaded attachments', async () => {
    mockApplicationPackageModel.findOne = jest
      .fn()
      .mockReturnValue(makeLeanExec(mockPackage));
    mockAttachmentsService.findByApplicationPackageId.mockResolvedValue([
      mockPendingAttachment,
    ]);
    mockAttachmentsService.findById.mockResolvedValue(mockFullAttachment);
    mockSiebelApiService.createAttachment.mockResolvedValue({});

    const result = await service.submitDocumentsToICM(
      APPLICATION_PACKAGE_ID,
      HOUSEHOLD_MEMBER_ID,
      AttachmentType.MEDICAL_ASSESSMENT,
      USER_ID,
    );

    expect(result).toEqual({ success: true, attachmentsUploaded: 1 });
  });
});

describe('ApplicationPackageService - submitApplicationPackage — BCSC re-prospect', () => {
  let service: ApplicationPackageService;

  const mockFindOne = jest.fn();
  const mockFindOneAndUpdate = jest.fn();
  const mockApplicationPackageModel = {
    findOne: mockFindOne,
    findOneAndUpdate: mockFindOneAndUpdate,
  };

  const mockHouseholdService = {
    findAllHouseholdMembers: jest.fn(),
    updateHouseholdMember: jest.fn(),
  };

  const mockApplicationFormService = {
    findAllByApplicationPackageId: jest.fn(),
    convertFormDataToXml: jest.fn(),
    saveSiebelAttachmentId: jest.fn(),
    findByPackageAndUser: jest.fn(),
  };

  const mockUserService = {
    findOne: jest.fn(),
    updateUser: jest.fn(),
  };

  const mockSiebelApiService = {
    createProspect: jest.fn(),
    updateServiceRequestFields: jest.fn(),
  };

  const mockUserUtil = {
    firstAndMiddleName: jest
      .fn()
      .mockReturnValue({ firstName: 'Jane', middleName: '' }),
    toTitleCase: jest.fn((s: string) => s),
    sexToGenderType: jest.fn().mockReturnValue('F'),
  };

  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn(),
  };

  const PACKAGE_ID = 'pkg-bcsc-001';
  const USER_ID = 'user-bcsc-001';
  const SR_ID = 'sr-bcsc-001';

  const mockPackage: Partial<ApplicationPackage> = {
    applicationPackageId: PACKAGE_ID,
    userId: USER_ID,
    srId: SR_ID,
  };

  const mockPrimaryUser = {
    id: USER_ID,
    first_name: 'Jane',
    last_name: 'Doe',
    bc_services_card_id: 'bcsc-did-001',
    dateOfBirth: '1990-03-15',
    street_address: '123 Main St',
    city: 'Victoria',
    region: 'BC',
    country: 'CA',
    postal_code: 'V8V 1A1',
    email: 'jane@example.com',
    home_phone: '250-555-0100',
    alternate_phone: '',
    sex: 'F',
    bcsc_update_pending: true,
  };

  const mockSelfMember = {
    householdMemberId: 'hm-self-001',
    relationshipToPrimary: RelationshipToPrimary.Self,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockFindOne.mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockPackage),
      }),
    });
    mockFindOneAndUpdate.mockResolvedValue(mockPackage);

    mockHouseholdService.findAllHouseholdMembers.mockResolvedValue([
      mockSelfMember,
    ]);
    mockHouseholdService.updateHouseholdMember.mockResolvedValue(
      mockSelfMember,
    );

    // Empty forms — satisfies both isApplicationPackageComplete and the attachment loop
    mockApplicationFormService.findAllByApplicationPackageId.mockResolvedValue(
      [],
    );

    mockUserService.findOne.mockResolvedValue(mockPrimaryUser);
    mockUserService.updateUser.mockResolvedValue(mockPrimaryUser);

    mockSiebelApiService.createProspect.mockResolvedValue({
      items: { Id: 'new-prospect-id' },
    });
    mockSiebelApiService.updateServiceRequestFields.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApplicationPackageService,
        {
          provide: getModelToken(ApplicationPackage.name),
          useValue: mockApplicationPackageModel,
        },
        {
          provide: ApplicationFormService,
          useValue: mockApplicationFormService,
        },
        { provide: HouseholdService, useValue: mockHouseholdService },
        {
          provide: NotificationService,
          useValue: {
            sendApplicationReady: jest.fn(),
            sendApplicationSubmitted: jest.fn(),
          },
        },
        { provide: AccessCodeService, useValue: {} },
        { provide: UserService, useValue: mockUserService },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: SiebelApiService, useValue: mockSiebelApiService },
        { provide: UserUtil, useValue: mockUserUtil },
        {
          provide: ApplicationPackageQueueService,
          useValue: { enqueueReferralSubmission: jest.fn() },
        },
        { provide: AttachmentsService, useValue: {} },
        {
          provide: `PinoLogger:${ApplicationFormService.name}`,
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get<ApplicationPackageService>(ApplicationPackageService);
  });

  it('does not call createProspect when bcsc_update_pending is false', async () => {
    mockUserService.findOne.mockResolvedValue({
      ...mockPrimaryUser,
      bcsc_update_pending: false,
    });

    await service.submitApplicationPackage(PACKAGE_ID, USER_ID);

    expect(mockSiebelApiService.createProspect).not.toHaveBeenCalled();
  });

  it('calls createProspect with primary applicant data when bcsc_update_pending is true', async () => {
    await service.submitApplicationPackage(PACKAGE_ID, USER_ID);

    expect(mockSiebelApiService.createProspect).toHaveBeenCalledWith(
      expect.objectContaining({
        ServiceRequestId: SR_ID,
        IcmBcscDid: 'bcsc-did-001',
        Relationship: 'Key player',
        ApplicantFlag: 'Y',
      }),
    );
  });

  it('saves the returned prospectId to the primary household member', async () => {
    await service.submitApplicationPackage(PACKAGE_ID, USER_ID);

    expect(mockHouseholdService.updateHouseholdMember).toHaveBeenCalledWith(
      'hm-self-001',
      { prospectId: 'new-prospect-id' },
    );
  });

  it('clears bcsc_update_pending after a successful re-prospect', async () => {
    await service.submitApplicationPackage(PACKAGE_ID, USER_ID);

    expect(mockUserService.updateUser).toHaveBeenCalledWith(USER_ID, {
      bcsc_update_pending: false,
    });
  });

  it('does not save prospectId or clear flag when prospect response has no Id', async () => {
    mockSiebelApiService.createProspect.mockResolvedValue({ items: {} });

    const result = await service.submitApplicationPackage(PACKAGE_ID, USER_ID);

    expect(result.isComplete).toBe(true);
    expect(mockHouseholdService.updateHouseholdMember).not.toHaveBeenCalled();
    expect(mockUserService.updateUser).not.toHaveBeenCalledWith(USER_ID, {
      bcsc_update_pending: false,
    });
  });

  it('continues submission without clearing the flag when createProspect throws', async () => {
    mockSiebelApiService.createProspect.mockRejectedValue(
      new Error('Siebel unavailable'),
    );

    const result = await service.submitApplicationPackage(PACKAGE_ID, USER_ID);

    expect(result.isComplete).toBe(true);
    expect(mockUserService.updateUser).not.toHaveBeenCalledWith(USER_ID, {
      bcsc_update_pending: false,
    });
  });

  it('skips updateHouseholdMember but still clears the flag when no Self member exists', async () => {
    mockHouseholdService.findAllHouseholdMembers.mockResolvedValue([]);

    await service.submitApplicationPackage(PACKAGE_ID, USER_ID);

    expect(mockSiebelApiService.createProspect).toHaveBeenCalled();
    expect(mockHouseholdService.updateHouseholdMember).not.toHaveBeenCalled();
    expect(mockUserService.updateUser).toHaveBeenCalledWith(USER_ID, {
      bcsc_update_pending: false,
    });
  });
});
