import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ApplicationFormStatus } from '../../application-form/enums/application-form-status.enum';
import {
  ApplicationFormType,
  getFormIdForFormType,
} from '../../application-form/enums/application-form-types.enum';
import { ApplicationFormService } from '../../application-form/services/application-form.service';
import { AttachmentsService } from '../../attachments/attachments.service';
import { AttachmentType } from '../../attachments/enums/attachment-types.enum';
import { UserService } from '../../auth/user.service';
import { UserUtil } from '../../common/utils/user.util';
import { RelationshipToPrimary } from '../../household/enums/relationship-to-primary.enum';
import { AccessCodeService } from '../../household/services/access-code.service';
import { HouseholdService } from '../../household/services/household.service';
import { NotificationService } from '../../notifications/services/notification.service';
import {
  SiebelApiError,
  SiebelApiService,
} from '../../siebel/siebel-api.service';
import { CancelApplicationPackageDto } from '../dto/cancel-application-package.dto';
import { CreateApplicationPackageDto } from '../dto/create-application-package.dto';
import { SubmitReferralRequestDto } from '../dto/submit-referral-request.dto';
import { UpdateApplicationPackageDto } from '../dto/update-application-package.dto';
import {
  ApplicationPackageStatus,
  ServiceRequestStage,
} from '../enums/application-package-status.enum';
import {
  ApplicationPackageSubSubType,
  ApplicationPackageSubType,
} from '../enums/application-package-subtypes.enum';
import { ApplicationPackageQueueService } from '../queue/application-package-queue.service';
import { ApplicationPackage } from '../schema/application-package.schema';
import { ApplicationPackageService } from '../services/application-package.service';
import { ProspectService } from '../services/prospect.service';

const queryFor = (value: unknown): Record<string, unknown> => {
  const exec = jest.fn().mockResolvedValue(value);
  const query: Record<string, unknown> = {
    exec,
    lean: jest.fn(() => query),
    select: jest.fn(() => query),
    sort: jest.fn(() => query),
    then: (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve(value).then(onFulfilled),
  };
  return query;
};

const failingQuery = (error: Error): Record<string, unknown> => {
  const exec = jest.fn().mockRejectedValue(error);
  const query: Record<string, unknown> = {
    exec,
    lean: jest.fn(() => query),
    select: jest.fn(() => query),
    sort: jest.fn(() => query),
    then: (onFulfilled: (v: unknown) => unknown) =>
      Promise.reject(error).then(onFulfilled),
  };
  return query;
};

const testLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  setContext: jest.fn(),
};

const compileService = (mocks: {
  model?: Record<string, unknown>;
  forms?: Record<string, unknown>;
  household?: Record<string, unknown>;
  accessCodes?: Record<string, unknown>;
  users?: Record<string, unknown>;
  config?: Record<string, unknown>;
  siebel?: Record<string, unknown>;
  userUtil?: Record<string, unknown>;
  queue?: Record<string, unknown>;
  attachments?: Record<string, unknown>;
  prospects?: Record<string, unknown>;
}): Promise<ApplicationPackageService> => {
  const moduleRef = Test.createTestingModule({
    providers: [
      ApplicationPackageService,
      {
        provide: getModelToken(ApplicationPackage.name),
        useValue: mocks.model ?? [],
      },
      { provide: ApplicationFormService, useValue: mocks.forms ?? {} },
      { provide: HouseholdService, useValue: mocks.household ?? {} },
      {
        provide: NotificationService,
        useValue: {
          sendApplicationReady: jest.fn(),
          sendApplicationSubmitted: jest.fn(),
        },
      },
      { provide: AccessCodeService, useValue: mocks.accessCodes ?? {} },
      { provide: UserService, useValue: mocks.users ?? {} },
      { provide: ConfigService, useValue: mocks.config ?? { get: jest.fn() } },
      { provide: SiebelApiService, useValue: mocks.siebel ?? {} },
      {
        provide: UserUtil,
        useValue: mocks.userUtil ?? {
          firstAndMiddleName: jest
            .fn()
            .mockReturnValue({ firstName: 'Jane', middleName: '' }),
          toTitleCase: jest.fn((s: string) => s),
          sexToGenderType: jest.fn(),
        },
      },
      { provide: ApplicationPackageQueueService, useValue: mocks.queue ?? {} },
      { provide: AttachmentsService, useValue: mocks.attachments ?? {} },
      {
        provide: `PinoLogger:${ApplicationFormService.name}`,
        useValue: testLogger,
      },
      { provide: ProspectService, useValue: mocks.prospects ?? {} },
    ],
  });
  return moduleRef
    .compile()
    .then((m) => m.get<ApplicationPackageService>(ApplicationPackageService));
};

describe('ApplicationPackageService - updateApplicationPackageStage', () => {
  let service: ApplicationPackageService;

  // --- mock dependencies ---
  const mockFindOneAndUpdate = jest.fn();

  const mockFindOne = jest.fn();
  const mockApplicationPackageModel = {
    findOneAndUpdate: mockFindOneAndUpdate,
    findOne: mockFindOne,
    updateOne: jest.fn().mockResolvedValue({}),
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

  const mockProspectService = { createKeyPlayerProspect: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default: findOneAndUpdate returns updated package
    mockFindOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockUpdatedPackage),
      }),
    });

    mockFindOne.mockReturnValue({
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
        { provide: ProspectService, useValue: mockProspectService },
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

    it('skips form creation when the claim is lost (another instance already transitioned)', async () => {
      mockHouseholdService.findPrimaryApplicant.mockResolvedValue(
        mockPrimaryApplicant,
      );
      // claim loses: the atomic findOneAndUpdate matches no document
      mockFindOneAndUpdate.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      });

      await service.updateApplicationPackageStage(
        mockApplicationPackage as ApplicationPackage,
        ServiceRequestStage.APPLICATION,
      );

      expect(
        mockApplicationFormService.createApplicationForm,
      ).not.toHaveBeenCalled();
      // returns the current package via fin
      expect(mockFindOne).toHaveBeenCalledWith({
        applicationPackageId: mockApplicationPackage.applicationPackageId,
      });
    });

    it('skips notification when the claim isready transitioned)', async () => {
      mockHouseholdService.findPrimaryApplicant.mockResolvedValue(
        mockPrimaryApplicant,
      );
      mockFindOneAndUpdate.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      });

      await service.updateApplicationPackageStage(
        mockApplicationPackage as ApplicationPackage,
        ServiceRequestStage.APPLICATION,
      );

      expect(
        mockNotificationService.sendApplicationReady,
      ).not.toHaveBeenCalled();
    });

    it('claim won but forms already exist — ry guard)', async () => {
      mockHouseholdService.findPrimaryApplicant.mockResolvedValue(
        mockPrimaryApplicant,
      );
      // claim wins (default mock returns the package), but a prior partial run
      // already created every recipe form f
      mockApplicationFormService.getApplicationFormByHouseholdId.mockResolvedValue(
        [
          ApplicationFormType.ABOUTME,
          ApplicationFormType.HOUSEHOLD,
          ApplicationFormType.CHILDREN,
          ApplicationFormType.PLACEMENT,
          ApplicationFormType.REFERENCES,
          ApplicationFormType.DISCLOSURECONSENT,
          ApplicationFormType.PCCCONSENT,
        ].map((type) => ({ type, applicationFormId: `existing-${type}` })),
      );

      await service.updateApplicationPackageStage(
        mockApplicationPackage as ApplicationPackage,
        ServiceRequestStage.APPLICATION,
      );

      expect(
        mockApplicationFormService.createApplicationForm,
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

      const [filter, update, options] = mockFindOneAndUpdate.mock.calls[0] as [
        Record<string, unknown>,
        { $set: Record<string, unknown> },
        { new: boolean },
      ];

      expect(filter).toMatchObject({
        applicationPackageId: mockApplicationPackage.applicationPackageId,
        srStage: { $in: [ServiceRequestStage.REFERRAL, null] },
      });
      expect(update.$set).toMatchObject({
        srStage: ServiceRequestStage.APPLICATION,
        status: ApplicationPackageStatus.APPLICATION,
      });
      expect(options).toEqual({ new: false });
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
      // claim finds nothing to update...
      mockFindOneAndUpdate.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      });
      // ...and the follow-up read also finds nothing
      mockFindOne.mockReturnValue({
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
  const mockProspectService = { createKeyPlayerProspect: jest.fn() };

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
        { provide: ProspectService, useValue: mockProspectService },
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
    findIncompletePrimaryApplicantForms: jest.fn(),
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

    mockHouseholdService.findPrimaryApplicant.mockResolvedValue(mockSelfMember);
    mockApplicationFormService.findIncompletePrimaryApplicantForms.mockResolvedValue(
      [],
    );

    mockApplicationFormService.createScreeningFormsAndAccessCode.mockResolvedValue(
      undefined,
    );
    mockApplicationFormService.getApplicationFormByHouseholdId.mockResolvedValue(
      [],
    );
    const mockProspectService = { createKeyPlayerProspect: jest.fn() };

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
        { provide: ProspectService, useValue: mockProspectService },
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
    updateServiceRequestFields: jest.fn(),
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

  const mockProspectService = { createKeyPlayerProspect: jest.fn() };

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
        { provide: ProspectService, useValue: mockProspectService },
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
    findPrimaryApplicant: jest.fn(),
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
    updateServiceRequestStage: jest.fn(),
  };

  const mockApplicationPackageQueueService = {
    enqueueReferralSubmission: jest.fn(),
    enqueueProspectCreation: jest.fn(),
  };

  const mockProspectService = { createKeyPlayerProspect: jest.fn() };

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
    mockHouseholdService.findPrimaryApplicant.mockResolvedValue(null);

    // Empty forms — satisfies both isApplicationPackageComplete and the attachment loop
    mockApplicationFormService.findAllByApplicationPackageId.mockResolvedValue(
      [],
    );

    mockUserService.findOne.mockResolvedValue(mockPrimaryUser);
    mockUserService.updateUser.mockResolvedValue(mockPrimaryUser);

    mockProspectService.createKeyPlayerProspect.mockResolvedValue(
      'new-prospect-id',
    );
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
          useValue: mockApplicationPackageQueueService,
        },
        { provide: AttachmentsService, useValue: {} },
        {
          provide: `PinoLogger:${ApplicationFormService.name}`,
          useValue: mockLogger,
        },
        { provide: ProspectService, useValue: mockProspectService },
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

    expect(mockProspectService.createKeyPlayerProspect).not.toHaveBeenCalled();
  });

  it('calls createKeyPlayerProspect with primary user, srId, and household member id', async () => {
    await service.submitApplicationPackage(PACKAGE_ID, USER_ID);

    expect(mockProspectService.createKeyPlayerProspect).toHaveBeenCalledWith(
      mockPrimaryUser,
      SR_ID,
      { householdMemberId: 'hm-self-001' },
    );
  });

  it('clears bcsc_update_pending after a successful re-prospect', async () => {
    await service.submitApplicationPackage(PACKAGE_ID, USER_ID);

    expect(mockUserService.updateUser).toHaveBeenCalledWith(USER_ID, {
      bcsc_update_pending: false,
    });
  });

  it('does not clear the flag when ProspectService throws for a missing prospect id', async () => {
    mockProspectService.createKeyPlayerProspect.mockRejectedValue(
      new InternalServerErrorException('Failed to create prospect'),
    );

    const result = await service.submitApplicationPackage(PACKAGE_ID, USER_ID);

    expect(result.isComplete).toBe(true);
    expect(mockUserService.updateUser).not.toHaveBeenCalledWith(USER_ID, {
      bcsc_update_pending: false,
    });
  });

  it('continues submission without clearing the flag when createKeyPlayerProspect throws', async () => {
    mockProspectService.createKeyPlayerProspect.mockRejectedValue(
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

    expect(mockProspectService.createKeyPlayerProspect).toHaveBeenCalledWith(
      mockPrimaryUser,
      SR_ID,
      { householdMemberId: undefined },
    );
    expect(mockUserService.updateUser).toHaveBeenCalledWith(USER_ID, {
      bcsc_update_pending: false,
    });
  });

  describe('activateNewApplication', () => {
    const APPLICATION_PACKAGE_ID = 'pkg-001';
    const USER_ID = 'user-001';
    const BCSC_DID = 'bcsc-did-999';

    it('updates the package stage and the Siebel SR when srId is present', async () => {
      const pkg = {
        applicationPackageId: APPLICATION_PACKAGE_ID,
        srId: 'sr-001',
      };
      jest
        .spyOn(service, 'getApplicationPackage')
        .mockResolvedValue(pkg as any);
      jest
        .spyOn(service, 'updateApplicationPackageStage')
        .mockResolvedValue(undefined as any);

      mockHouseholdService.findPrimaryApplicant.mockResolvedValue({
        householdMemberId: 'hm-self-001',
        prospectId: null,
      });

      await service.activateNewApplication(
        APPLICATION_PACKAGE_ID,
        USER_ID,
        BCSC_DID,
      );

      expect(service.getApplicationPackage).toHaveBeenCalledWith(
        APPLICATION_PACKAGE_ID,
        USER_ID,
      );
      expect(
        mockApplicationPackageQueueService.enqueueProspectCreation,
      ).toHaveBeenCalledWith(
        APPLICATION_PACKAGE_ID,
        BCSC_DID,
        'hm-self-001',
        'sr-001',
      );
      expect(service.updateApplicationPackageStage).toHaveBeenCalledWith(
        pkg,
        ServiceRequestStage.APPLICATION,
      );
      expect(
        mockSiebelApiService.updateServiceRequestStage,
      ).toHaveBeenCalledWith('sr-001', ServiceRequestStage.APPLICATION);
      expect(
        mockSiebelApiService.updateServiceRequestFields,
      ).toHaveBeenCalledWith('sr-001', { 'ICM BCSC DID': BCSC_DID });
    });

    it('does not call Siebel when the package has no srId', async () => {
      const pkg = { applicationPackageId: APPLICATION_PACKAGE_ID, srId: null };
      jest
        .spyOn(service, 'getApplicationPackage')
        .mockResolvedValue(pkg as any);
      jest
        .spyOn(service, 'updateApplicationPackageStage')
        .mockResolvedValue(undefined as any);

      await service.activateNewApplication(
        APPLICATION_PACKAGE_ID,
        USER_ID,
        BCSC_DID,
      );

      expect(
        mockSiebelApiService.updateServiceRequestStage,
      ).not.toHaveBeenCalled();
    });
  });
});

describe('ApplicationPackageService - cancelApplicationPackage', () => {
  let service: ApplicationPackageService;

  const PACKAGE_ID = 'pkg-cancel-001';
  const USER_ID = 'user-cancel-001';
  const SR_ID = 'sr-cancel-001';

  const mockModel = { findOne: jest.fn() };
  const mockSiebel = {
    getIcmServiceRequestById: jest.fn(),
    createSRNotification: jest.fn(),
    updateServiceRequestFields: jest.fn(),
  };
  const mockQueue = { enqueueCancellationNotification: jest.fn() };
  const mockConfig = { get: jest.fn() };

  const dto: CancelApplicationPackageDto = {
    applicationPackageId: PACKAGE_ID,
    userId: USER_ID,
  };

  const assignedSr = {
    'Assigned To': 'John',
    'Assigned To Id': 'assignee-1',
    'Service Request Number': 'SR-123',
  };

  const packageDoc = (
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    applicationPackageId: PACKAGE_ID,
    userId: USER_ID,
    srId: SR_ID,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSiebel.getIcmServiceRequestById.mockResolvedValue(assignedSr);
    service = await compileService({
      model: mockModel,
      siebel: mockSiebel,
      queue: mockQueue,
      config: mockConfig,
    });
  });

  it('throws NotFoundException when the package is not found', async () => {
    mockModel.findOne.mockReturnValue(queryFor(null));

    await expect(service.cancelApplicationPackage(dto)).rejects.toThrow(
      new NotFoundException('Application package not found or access denied'),
    );
  });

  it('withdraws locally without touching Siebel when there is no srId', async () => {
    const doc = packageDoc({ srId: undefined });
    mockModel.findOne.mockReturnValue(queryFor(doc));

    await service.cancelApplicationPackage(dto);

    expect(mockSiebel.getIcmServiceRequestById).not.toHaveBeenCalled();
    expect(doc.save).toHaveBeenCalledTimes(1);
    expect(doc.status).toBe(ApplicationPackageStatus.WITHDRAWN);
  });

  it('skips the notification but still withdraws when the SR is missing in ICM', async () => {
    mockSiebel.getIcmServiceRequestById.mockResolvedValue(null);
    const doc = packageDoc();
    mockModel.findOne.mockReturnValue(queryFor(doc));

    await service.cancelApplicationPackage(dto);

    expect(mockSiebel.createSRNotification).not.toHaveBeenCalled();
    expect(doc.save).toHaveBeenCalledTimes(1);
  });

  it('skips the notification when the SR is unassigned', async () => {
    mockSiebel.getIcmServiceRequestById.mockResolvedValue({
      'Service Request Number': 'SR-123',
    });
    const doc = packageDoc();
    mockModel.findOne.mockReturnValue(queryFor(doc));

    await service.cancelApplicationPackage(dto);

    expect(mockSiebel.createSRNotification).not.toHaveBeenCalled();
    expect(doc.save).toHaveBeenCalledTimes(1);
  });

  it('notifies the assignee and withdraws for an assigned SR', async () => {
    const doc = packageDoc();
    mockModel.findOne.mockReturnValue(queryFor(doc));

    await service.cancelApplicationPackage(dto);

    expect(mockSiebel.createSRNotification).toHaveBeenCalledWith(SR_ID, {
      serviceRequestNumber: 'SR-123',
      owner: 'assignee-1',
      assignedTo: 'John',
    });
    expect(mockSiebel.updateServiceRequestFields).not.toHaveBeenCalled();
    expect(doc.save).toHaveBeenCalledTimes(1);
  });

  it('resolves the SR in ICM when the OCT2027 release flag is enabled', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 8, 4));
    try {
      mockConfig.get.mockImplementation((key: string) =>
        key === 'OCT2027_RELEASE_ENABLED' ? 'true' : undefined,
      );
      const doc = packageDoc();
      mockModel.findOne.mockReturnValue(queryFor(doc));

      await service.cancelApplicationPackage(dto);

      expect(mockSiebel.updateServiceRequestFields).toHaveBeenCalledWith(
        SR_ID,
        {
          Resolution: 'Withdrawn',
          'CP Outcome': 'Withdrawn via portal on 09/04/2026',
          'ICM CGA Resolution Decision Date': '09/04/2026',
        },
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('queues the cancellation notification on a Siebel connectivity failure (no status)', async () => {
    mockSiebel.getIcmServiceRequestById.mockRejectedValue(
      new SiebelApiError('socket hang up'),
    );
    const doc = packageDoc();
    mockModel.findOne.mockReturnValue(queryFor(doc));

    await service.cancelApplicationPackage(dto);

    expect(mockQueue.enqueueCancellationNotification).toHaveBeenCalledWith(
      PACKAGE_ID,
      SR_ID,
    );
    expect(doc.save).toHaveBeenCalledTimes(1);
  });

  it('queues the cancellation notification on a 403 IP-not-allowed failure', async () => {
    mockSiebel.getIcmServiceRequestById.mockRejectedValue(
      new SiebelApiError('IP address not allowed', 403),
    );
    const doc = packageDoc();
    mockModel.findOne.mockReturnValue(queryFor(doc));

    await service.cancelApplicationPackage(dto);

    expect(mockQueue.enqueueCancellationNotification).toHaveBeenCalledWith(
      PACKAGE_ID,
      SR_ID,
    );
    expect(doc.save).toHaveBeenCalledTimes(1);
  });

  it('throws InternalServerErrorException and does not withdraw on other Siebel errors', async () => {
    mockSiebel.getIcmServiceRequestById.mockRejectedValue(
      new SiebelApiError('Server error', 500),
    );
    const doc = packageDoc();
    mockModel.findOne.mockReturnValue(queryFor(doc));

    await expect(service.cancelApplicationPackage(dto)).rejects.toThrow(
      new InternalServerErrorException('Failed to cancel application package'),
    );
    expect(doc.save).not.toHaveBeenCalled();
  });
});

describe('ApplicationPackageService - markPackageWithdrawn', () => {
  let service: ApplicationPackageService;
  const mockModel = { updateOne: jest.fn().mockResolvedValue({}) };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockModel.updateOne.mockResolvedValue({});
    service = await compileService({ model: mockModel });
  });

  it('sets the status to WITHDRAWN via updateOne', async () => {
    await service.markPackageWithdrawn('pkg-1');

    expect(mockModel.updateOne).toHaveBeenCalledWith(
      { applicationPackageId: { $eq: 'pkg-1' } },
      { $set: { status: ApplicationPackageStatus.WITHDRAWN } },
    );
  });
});

describe('ApplicationPackageService - deleteWithdrawnPackages', () => {
  let service: ApplicationPackageService;

  const mockModel = {
    find: jest.fn(),
    deleteMany: jest.fn().mockResolvedValue({}),
  };
  const mockForms = { deleteByApplicationPackageId: jest.fn() };
  const mockAccessCodes = { deleteByApplicationPackageId: jest.fn() };
  const mockHousehold = {
    deleteAllMembersByApplicationPackageId: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockModel.deleteMany.mockResolvedValue({});
    mockForms.deleteByApplicationPackageId.mockResolvedValue(undefined);
    mockAccessCodes.deleteByApplicationPackageId.mockResolvedValue(undefined);
    mockHousehold.deleteAllMembersByApplicationPackageId.mockResolvedValue(
      undefined,
    );
    service = await compileService({
      model: mockModel,
      forms: mockForms,
      household: mockHousehold,
      accessCodes: mockAccessCodes,
    });
  });

  it('does nothing when there are no withdrawn packages', async () => {
    mockModel.find.mockReturnValue(queryFor([]));

    await service.deleteWithdrawnPackages('user-1');

    expect(mockModel.deleteMany).not.toHaveBeenCalled();
    expect(mockForms.deleteByApplicationPackageId).not.toHaveBeenCalled();
  });

  it('deletes forms, access codes and household members for each withdrawn package, then the packages', async () => {
    mockModel.find.mockReturnValue(
      queryFor([
        { applicationPackageId: 'pkg-1' },
        { applicationPackageId: 'pkg-2' },
      ]),
    );

    await service.deleteWithdrawnPackages('user-1');

    expect(mockForms.deleteByApplicationPackageId).toHaveBeenCalledWith(
      'pkg-1',
    );
    expect(mockForms.deleteByApplicationPackageId).toHaveBeenCalledWith(
      'pkg-2',
    );
    expect(mockAccessCodes.deleteByApplicationPackageId).toHaveBeenCalledWith(
      'pkg-1',
    );
    expect(mockAccessCodes.deleteByApplicationPackageId).toHaveBeenCalledWith(
      'pkg-2',
    );
    expect(
      mockHousehold.deleteAllMembersByApplicationPackageId,
    ).toHaveBeenCalledWith('pkg-1');
    expect(
      mockHousehold.deleteAllMembersByApplicationPackageId,
    ).toHaveBeenCalledWith('pkg-2');
    expect(mockModel.deleteMany).toHaveBeenCalledWith({
      applicationPackageId: { $in: ['pkg-1', 'pkg-2'] },
    });
  });
});

describe('ApplicationPackageService - updateApplicationPackage', () => {
  let service: ApplicationPackageService;
  const mockModel = { findOneAndUpdate: jest.fn() };

  const updated = { applicationPackageId: 'pkg-1', userId: 'user-1' };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockModel.findOneAndUpdate.mockReturnValue(queryFor(updated));
    service = await compileService({ model: mockModel });
  });

  it('returns the updated package', async () => {
    const dto: UpdateApplicationPackageDto = { hasPartner: true };

    const result = await service.updateApplicationPackage(
      'pkg-1',
      dto,
      'user-1',
    );

    expect(result).toBe(updated);
    expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
      { applicationPackageId: { $eq: 'pkg-1' }, userId: { $eq: 'user-1' } },
      { $set: dto },
      { new: true, runValidators: true },
    );
  });

  it('throws NotFoundException when the package is not found for the user', async () => {
    mockModel.findOneAndUpdate.mockReturnValue(queryFor(null));

    await expect(
      service.updateApplicationPackage('pkg-1', {}, 'user-1'),
    ).rejects.toThrow(
      new NotFoundException(
        'Application package with ID pkg-1 not found or access denied',
      ),
    );
  });

  it('wraps database errors in InternalServerErrorException', async () => {
    mockModel.findOneAndUpdate.mockReturnValue(
      failingQuery(new Error('connection lost')),
    );

    await expect(
      service.updateApplicationPackage('pkg-1', {}, 'user-1'),
    ).rejects.toThrow(
      new InternalServerErrorException('Could not update application package'),
    );
  });
});

describe('ApplicationPackageService - getApplicationPackage', () => {
  let service: ApplicationPackageService;
  const mockModel = { findOne: jest.fn() };

  const pkg = { applicationPackageId: 'pkg-1', userId: 'user-1' };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockModel.findOne.mockReturnValue(queryFor(pkg));
    service = await compileService({ model: mockModel });
  });

  it('returns the package for the owning user', async () => {
    const result = await service.getApplicationPackage('pkg-1', 'user-1');

    expect(result).toBe(pkg);
    expect(mockModel.findOne).toHaveBeenCalledWith({
      applicationPackageId: { $eq: 'pkg-1' },
      userId: { $eq: 'user-1' },
    });
  });

  it('throws NotFoundException when not found or not owned', async () => {
    mockModel.findOne.mockReturnValue(queryFor(null));

    await expect(
      service.getApplicationPackage('pkg-1', 'user-1'),
    ).rejects.toThrow(
      new NotFoundException('Application package not found or access denied'),
    );
  });

  it('wraps unexpected errors in InternalServerErrorException', async () => {
    mockModel.findOne.mockReturnValue(failingQuery(new Error('db down')));

    await expect(
      service.getApplicationPackage('pkg-1', 'user-1'),
    ).rejects.toThrow(
      new InternalServerErrorException('Failed to fetch application package'),
    );
  });
});

describe('ApplicationPackageService - getApplicationPackages', () => {
  let service: ApplicationPackageService;
  const mockModel = { find: jest.fn() };

  const packages = [
    { applicationPackageId: 'pkg-1' },
    { applicationPackageId: 'pkg-2' },
  ];

  beforeEach(async () => {
    jest.clearAllMocks();
    mockModel.find.mockReturnValue(queryFor(packages));
    service = await compileService({ model: mockModel });
  });

  it('returns all packages for the user, most recent first', async () => {
    const result = await service.getApplicationPackages('user-1');

    expect(result).toBe(packages);
    expect(mockModel.find).toHaveBeenCalledWith({ userId: { $eq: 'user-1' } });
  });

  it('wraps database errors in InternalServerErrorException', async () => {
    mockModel.find.mockReturnValue(failingQuery(new Error('db down')));

    await expect(service.getApplicationPackages('user-1')).rejects.toThrow(
      new InternalServerErrorException('Failed to fetch application packages'),
    );
  });
});

describe('ApplicationPackageService - getApplicationFormsByPackageId', () => {
  let service: ApplicationPackageService;
  const mockForms = { findShortByPackageAndUser: jest.fn() };

  const forms = [{ applicationFormId: 'form-1' }];

  beforeEach(async () => {
    jest.clearAllMocks();
    mockForms.findShortByPackageAndUser.mockResolvedValue(forms);
    service = await compileService({ forms: mockForms });
  });

  it('returns the short form list from the form service', async () => {
    const result = await service.getApplicationFormsByPackageId(
      'pkg-1',
      'user-1',
    );

    expect(result).toBe(forms);
    expect(mockForms.findShortByPackageAndUser).toHaveBeenCalledWith(
      'pkg-1',
      'user-1',
    );
  });

  it('wraps errors in InternalServerErrorException', async () => {
    mockForms.findShortByPackageAndUser.mockRejectedValue(new Error('db down'));

    await expect(
      service.getApplicationFormsByPackageId('pkg-1', 'user-1'),
    ).rejects.toThrow(
      new InternalServerErrorException('Failed to fetch application forms'),
    );
  });
});

describe('ApplicationPackageService - saveReferralContactData', () => {
  let service: ApplicationPackageService;

  const mockModel = { findOne: jest.fn() };
  const mockHousehold = {
    findPrimaryApplicant: jest.fn(),
    updateHouseholdMember: jest.fn(),
  };
  const mockUsers = { updateUser: jest.fn() };

  const dto: SubmitReferralRequestDto = {
    email: 'jane@example.com',
    sex: 'F',
    home_phone: '(250) 555-0100',
    alternate_phone: '(250) 555-0200',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockModel.findOne.mockReturnValue(
      queryFor({ applicationPackageId: 'pkg-1', userId: 'user-1' }),
    );
    mockHousehold.findPrimaryApplicant.mockResolvedValue({
      householdMemberId: 'hm-1',
    });
    mockHousehold.updateHouseholdMember.mockResolvedValue({});
    mockUsers.updateUser.mockResolvedValue({});
    service = await compileService({
      model: mockModel,
      household: mockHousehold,
      users: mockUsers,
    });
  });

  it('throws NotFoundException when the package is not found', async () => {
    mockModel.findOne.mockReturnValue(queryFor(null));

    await expect(
      service.saveReferralContactData('pkg-1', 'user-1', dto),
    ).rejects.toThrow(new NotFoundException('Application package not found'));
  });

  it('updates the primary household member and the user record', async () => {
    const result = await service.saveReferralContactData(
      'pkg-1',
      'user-1',
      dto,
    );

    expect(mockHousehold.updateHouseholdMember).toHaveBeenCalledWith(
      'hm-1',
      expect.objectContaining({
        email: 'jane@example.com',
        genderType: 'F',
        homePhone: '(250) 555-0100',
        alternatePhone: '(250) 555-0200',
      }),
    );
    expect(mockUsers.updateUser).toHaveBeenCalledWith('user-1', {
      sex: 'F',
      email: 'jane@example.com',
      home_phone: '(250) 555-0100',
      alternate_phone: '(250) 555-0200',
    });
    expect(result).toEqual({
      message: 'Referral contact data saved successfully',
    });
  });

  it('still updates the user when there is no primary applicant household member', async () => {
    mockHousehold.findPrimaryApplicant.mockResolvedValue(null);

    const result = await service.saveReferralContactData(
      'pkg-1',
      'user-1',
      dto,
    );

    expect(mockHousehold.updateHouseholdMember).not.toHaveBeenCalled();
    expect(mockUsers.updateUser).toHaveBeenCalledWith(
      'user-1',
      expect.anything(),
    );
    expect(result.message).toBe('Referral contact data saved successfully');
  });
});

describe('ApplicationPackageService - submitReferralRequest', () => {
  let service: ApplicationPackageService;

  const mockModel = {
    findOne: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({}),
  };
  const mockForms = { findByPackageAndUser: jest.fn() };
  const mockHousehold = {
    findPrimaryApplicant: jest.fn(),
    updateHouseholdMember: jest.fn(),
  };
  const mockUsers = { updateUser: jest.fn() };
  const mockQueue = { enqueueReferralSubmission: jest.fn() };

  const dto: SubmitReferralRequestDto = {
    email: 'jane@example.com',
    sex: 'F',
    home_phone: '(250) 555-0100',
  };

  const referralPackage = {
    applicationPackageId: 'pkg-1',
    userId: 'user-1',
    subtype: ApplicationPackageSubType.FCH,
    subsubtype: ApplicationPackageSubSubType.FCH,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockModel.findOne.mockReturnValue(queryFor(referralPackage));
    mockModel.updateOne.mockResolvedValue({});
    mockForms.findByPackageAndUser.mockResolvedValue([]);
    mockHousehold.findPrimaryApplicant.mockResolvedValue({
      householdMemberId: 'hm-1',
    });
    mockHousehold.updateHouseholdMember.mockResolvedValue({});
    mockUsers.updateUser.mockResolvedValue({});
    mockQueue.enqueueReferralSubmission.mockResolvedValue(undefined);
    service = await compileService({
      model: mockModel,
      forms: mockForms,
      household: mockHousehold,
      users: mockUsers,
      queue: mockQueue,
    });
  });

  it('throws NotFoundException when the package is not found', async () => {
    mockModel.findOne.mockReturnValue(queryFor(null));

    await expect(
      service.submitReferralRequest('pkg-1', 'user-1', dto),
    ).rejects.toThrow(new NotFoundException('Application package not found'));
  });

  it('throws BadRequestException when the referral was already submitted', async () => {
    mockModel.findOne.mockReturnValue(
      queryFor({ ...referralPackage, srId: 'sr-1' }),
    );

    await expect(
      service.submitReferralRequest('pkg-1', 'user-1', dto),
    ).rejects.toThrow(new BadRequestException('Referral already submitted'));
  });

  it('throws BadRequestException when referral forms are incomplete', async () => {
    mockForms.findByPackageAndUser.mockResolvedValue([
      {
        type: ApplicationFormType.INDIGENOUS,
        status: ApplicationFormStatus.NEW,
      },
    ]);

    await expect(
      service.submitReferralRequest('pkg-1', 'user-1', dto),
    ).rejects.toThrow(
      new BadRequestException(
        'Cannot submit referral - 1 form(s) are incomplete',
      ),
    );
  });

  it('skips the form completeness check when the subtype has an empty referral recipe', async () => {
    mockModel.findOne.mockReturnValue(
      queryFor({
        ...referralPackage,
        subtype: ApplicationPackageSubType.OOC,
      }),
    );

    const result = await service.submitReferralRequest('pkg-1', 'user-1', dto);

    expect(mockForms.findByPackageAndUser).not.toHaveBeenCalled();
    expect(result.message).toBe('Referral submission queued successfully');
  });

  it('updates the status, saves contact data and enqueues the submission', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 8, 4));
    try {
      const result = await service.submitReferralRequest(
        'pkg-1',
        'user-1',
        dto,
      );

      expect(mockModel.updateOne).toHaveBeenCalledWith(
        { applicationPackageId: 'pkg-1' },
        {
          status: ApplicationPackageStatus.REFERRAL,
          updatedAt: new Date(2026, 8, 4),
        },
      );
      expect(mockHousehold.updateHouseholdMember).toHaveBeenCalledWith(
        'hm-1',
        expect.objectContaining({
          email: 'jane@example.com',
          genderType: 'F',
          homePhone: '(250) 555-0100',
        }),
      );
      expect(mockUsers.updateUser).toHaveBeenCalledWith('user-1', { sex: 'F' });
      expect(mockQueue.enqueueReferralSubmission).toHaveBeenCalledWith(
        'pkg-1',
        'user-1',
        dto,
      );
      expect(result).toEqual({
        message: 'Referral submission queued successfully',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('still resolves when enqueueing fails (fire and forget)', async () => {
    mockQueue.enqueueReferralSubmission.mockRejectedValue(
      new Error('queue unavailable'),
    );

    const result = await service.submitReferralRequest('pkg-1', 'user-1', dto);

    expect(result.message).toBe('Referral submission queued successfully');
    expect(testLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ applicationPackageId: 'pkg-1' }),
      'Failed to enqueue referral submission - will be picked up by scheduler',
    );
  });
});

describe('ApplicationPackageService - submitApplicationPackage — members, forms & attachments', () => {
  let service: ApplicationPackageService;

  const PACKAGE_ID = 'pkg-submit-001';
  const USER_ID = 'user-submit-001';
  const MEMBER_USER_ID = 'user-member-001';
  const SR_ID = 'sr-submit-001';

  const mockModel = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };
  const mockForms = {
    findByPackageAndUser: jest.fn(),
    findAllByApplicationPackageId: jest.fn(),
    convertFormDataToXml: jest.fn(),
    saveSiebelAttachmentId: jest.fn(),
  };
  const mockHousehold = {
    findAllHouseholdMembers: jest.fn(),
    updateHouseholdMember: jest.fn(),
  };
  const mockUsers = { findOne: jest.fn(), updateUser: jest.fn() };
  const mockSiebel = {
    createProspect: jest.fn(),
    createFormAttachment: jest.fn(),
    createAttachment: jest.fn(),
    updateServiceRequestFields: jest.fn(),
  };
  const mockAttachments = {
    findByHouseholdMemberId: jest.fn(),
    findById: jest.fn(),
    saveIcmAttachmentId: jest.fn(),
  };
  const mockProspects = { createKeyPlayerProspect: jest.fn() };
  const mockUserUtil = {
    firstAndMiddleName: jest.fn().mockImplementation((name: string) => ({
      firstName: name?.split(' ')[0] ?? '',
      middleName: '',
    })),
    toTitleCase: jest.fn((s: string) => s),
  };

  const basePackage = {
    applicationPackageId: PACKAGE_ID,
    userId: USER_ID,
    srId: SR_ID,
    subtype: ApplicationPackageSubType.FCH,
  };

  const primaryUser = {
    id: USER_ID,
    first_name: 'Jane',
    last_name: 'Doe',
    bcsc_update_pending: false,
    street_address: '123 Main St',
    city: 'Victoria',
    region: 'BC',
    postal_code: 'V8V 1A1',
    email: 'jane@example.com',
  };

  const selfMember = {
    householdMemberId: 'hm-self-1',
    relationshipToPrimary: RelationshipToPrimary.Self,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockUserUtil.firstAndMiddleName.mockImplementation((name: string) => ({
      firstName: name?.split(' ')[0] ?? '',
      middleName: '',
    }));
    mockUserUtil.toTitleCase.mockImplementation((s: string) => s);

    mockModel.findOne.mockImplementation((query: { userId?: string }) =>
      queryFor({ ...basePackage, ...query }),
    );
    mockModel.findOneAndUpdate.mockReturnValue(queryFor(basePackage));

    mockForms.findByPackageAndUser.mockResolvedValue([]);
    mockForms.findAllByApplicationPackageId.mockResolvedValue([]);
    mockForms.convertFormDataToXml.mockResolvedValue('<xml/>');

    mockHousehold.findAllHouseholdMembers.mockResolvedValue([selfMember]);
    mockHousehold.updateHouseholdMember.mockResolvedValue({});
    mockUsers.findOne.mockResolvedValue(primaryUser);
    mockUsers.updateUser.mockResolvedValue(primaryUser);

    mockSiebel.createProspect.mockResolvedValue({ Id: 'prospect-member-1' });
    mockSiebel.createFormAttachment.mockResolvedValue({
      items: { Id: 'siebel-1' },
    });
    mockSiebel.createAttachment.mockResolvedValue({ items: { Id: 'icm-1' } });
    mockSiebel.updateServiceRequestFields.mockResolvedValue({});

    mockProspects.createKeyPlayerProspect.mockResolvedValue(
      'prospect-primary-1',
    );

    service = await compileService({
      model: mockModel,
      forms: mockForms,
      household: mockHousehold,
      users: mockUsers,
      siebel: mockSiebel,
      attachments: mockAttachments,
      prospects: mockProspects,
      userUtil: mockUserUtil,
    });
  });

  describe('package lookup', () => {
    it('allows submission via a household member screening form when the user does not own the package', async () => {
      mockModel.findOne.mockImplementation((query: { userId?: string }) =>
        queryFor(query?.userId ? null : basePackage),
      );
      mockForms.findByPackageAndUser.mockResolvedValue([
        {
          type: ApplicationFormType.SCREENING,
          status: ApplicationFormStatus.COMPLETE,
        },
      ]);

      const result = await service.submitApplicationPackage(
        PACKAGE_ID,
        USER_ID,
      );

      expect(mockModel.findOne).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ serviceRequestId: SR_ID, isComplete: true });
    });

    it('throws NotFoundException when the user neither owns the package nor has a screening form', async () => {
      mockModel.findOne.mockReturnValue(queryFor(null));
      mockForms.findByPackageAndUser.mockResolvedValue([]);

      await expect(
        service.submitApplicationPackage(PACKAGE_ID, USER_ID),
      ).rejects.toThrow(
        new NotFoundException('Application package not found for user'),
      );
    });

    it('wraps the missing service request id error in InternalServerErrorException', async () => {
      mockModel.findOne.mockReturnValue(queryFor({ ...basePackage, srId: '' }));

      await expect(
        service.submitApplicationPackage(PACKAGE_ID, USER_ID),
      ).rejects.toThrow(
        new InternalServerErrorException(
          'Failed to submit application package',
        ),
      );
    });

    it('surfaces a missing owning user as the generic submission failure', async () => {
      mockModel.findOne.mockReturnValue(
        queryFor({ ...basePackage, userId: undefined }),
      );

      await expect(
        service.submitApplicationPackage(PACKAGE_ID, USER_ID),
      ).rejects.toThrow(
        new InternalServerErrorException(
          'Failed to submit application package',
        ),
      );
    });
  });

  describe('isApplicationPackageComplete', () => {
    it('returns early with isComplete false when a screening form is incomplete', async () => {
      mockForms.findAllByApplicationPackageId.mockResolvedValue([
        {
          type: ApplicationFormType.SCREENING,
          status: ApplicationFormStatus.NEW,
          applicationFormId: 'form-s-1',
          userId: USER_ID,
        },
      ]);

      const result = await service.submitApplicationPackage(
        PACKAGE_ID,
        USER_ID,
      );

      expect(result).toEqual({ serviceRequestId: SR_ID, isComplete: false });
      expect(mockProspects.createKeyPlayerProspect).not.toHaveBeenCalled();
      expect(mockSiebel.createFormAttachment).not.toHaveBeenCalled();
    });

    it('returns early with isComplete false when a non-referral form is incomplete', async () => {
      mockForms.findAllByApplicationPackageId.mockResolvedValue([
        {
          type: ApplicationFormType.ABOUTME,
          status: ApplicationFormStatus.DRAFT,
          applicationFormId: 'form-1',
        },
      ]);

      const result = await service.submitApplicationPackage(
        PACKAGE_ID,
        USER_ID,
      );

      expect(result.isComplete).toBe(false);
    });
  });

  describe('key player prospect', () => {
    it('creates a prospect for a Kinship primary applicant without one', async () => {
      mockModel.findOne.mockReturnValue(
        queryFor({ ...basePackage, subtype: ApplicationPackageSubType.OOC }),
      );

      await service.submitApplicationPackage(PACKAGE_ID, USER_ID);

      expect(mockProspects.createKeyPlayerProspect).toHaveBeenCalledWith(
        primaryUser,
        SR_ID,
        { householdMemberId: 'hm-self-1' },
      );
    });
  });

  describe('household member prospects', () => {
    it('builds the prospect payload from the BCSC user record for adult members', async () => {
      const memberUser = {
        id: MEMBER_USER_ID,
        first_name: 'Bob',
        last_name: 'smith',
        bc_services_card_id: 'did-member-1',
        dateOfBirth: '1985-01-01',
        street_address: '456 Oak St',
        city: 'Vancouver',
        region: 'BC',
        postal_code: 'V6B 1A1',
        email: 'bob@example.com',
        home_phone: '(250) 555-0200',
        alternate_phone: '',
      };
      mockHousehold.findAllHouseholdMembers.mockResolvedValue([
        selfMember,
        {
          householdMemberId: 'hm-spouse',
          relationshipToPrimary: RelationshipToPrimary.Spouse,
          userId: MEMBER_USER_ID,
          genderType: 'M',
        },
      ]);
      mockUsers.findOne.mockImplementation((id: string) =>
        id === MEMBER_USER_ID ? memberUser : primaryUser,
      );

      await service.submitApplicationPackage(PACKAGE_ID, USER_ID);

      expect(mockSiebel.createProspect).toHaveBeenCalledWith(
        expect.objectContaining({
          ServiceRequestId: SR_ID,
          IcmBcscDid: 'did-member-1',
          FirstName: 'Bob',
          LastName: 'smith',
          Relationship: RelationshipToPrimary.Spouse,
        }),
      );
      expect(mockHousehold.updateHouseholdMember).toHaveBeenCalledWith(
        'hm-spouse',
        {
          prospectId: 'prospect-member-1',
        },
      );
    });

    it('builds the prospect payload from the primary applicant address for members without a user account', async () => {
      mockHousehold.findAllHouseholdMembers.mockResolvedValue([
        selfMember,
        {
          householdMemberId: 'hm-child',
          relationshipToPrimary: RelationshipToPrimary.Child,
          firstName: 'Sara',
          lastName: 'kid',
          dateOfBirth: '2015-05-05',
        },
      ]);

      await service.submitApplicationPackage(PACKAGE_ID, USER_ID);

      expect(mockSiebel.createProspect).toHaveBeenCalledWith(
        expect.objectContaining({
          ServiceRequestId: SR_ID,
          IcmBcscDid: '',
          FirstName: 'Sara',
          StreetAddress: '123 Main St',
          Relationship: RelationshipToPrimary.Child,
        }),
      );
    });

    it('skips members that already have a prospect id', async () => {
      mockHousehold.findAllHouseholdMembers.mockResolvedValue([
        selfMember,
        {
          householdMemberId: 'hm-done',
          relationshipToPrimary: RelationshipToPrimary.Spouse,
          prospectId: 'prospect-existing',
        },
      ]);

      await service.submitApplicationPackage(PACKAGE_ID, USER_ID);

      expect(mockSiebel.createProspect).not.toHaveBeenCalled();
    });

    it('continues the submission when a member prospect fails', async () => {
      mockHousehold.findAllHouseholdMembers.mockResolvedValue([
        selfMember,
        {
          householdMemberId: 'hm-fail',
          relationshipToPrimary: RelationshipToPrimary.Spouse,
          firstName: 'Bob',
          lastName: 'smith',
          dateOfBirth: '1985-01-01',
        },
      ]);
      mockSiebel.createProspect.mockRejectedValue(new Error('Siebel down'));

      const result = await service.submitApplicationPackage(
        PACKAGE_ID,
        USER_ID,
      );

      expect(result.isComplete).toBe(true);
      expect(testLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ householdMemberId: 'hm-fail' }),
        'Failed to create prospect for household member',
      );
    });
  });

  describe('form attachments', () => {
    const formBase = {
      applicationFormId: 'form-1',
      householdMemberId: 'hm-self-1',
      userId: USER_ID,
    };

    it('attaches forms with data and saves the Siebel attachment id', async () => {
      mockForms.findAllByApplicationPackageId.mockResolvedValue([
        {
          ...formBase,
          type: ApplicationFormType.ABOUTME,
          status: ApplicationFormStatus.COMPLETE,
          formData: '{"q":"a"}',
        },
      ]);

      const result = await service.submitApplicationPackage(
        PACKAGE_ID,
        USER_ID,
      );

      expect(mockSiebel.createFormAttachment).toHaveBeenCalledWith(
        SR_ID,
        expect.objectContaining({
          fileName: 'About Me',
          template: getFormIdForFormType(ApplicationFormType.ABOUTME),
          xmlHierarchy: '<xml/>',
          fileContent: '{"q":"a"}',
        }),
      );
      expect(mockForms.saveSiebelAttachmentId).toHaveBeenCalledWith(
        'form-1',
        'siebel-1',
      );
      expect(result.isComplete).toBe(true);
    });

    it('names screening forms after the household member', async () => {
      mockForms.findAllByApplicationPackageId.mockResolvedValue([
        {
          ...formBase,
          type: ApplicationFormType.DISCLOSURECONSENT,
          status: ApplicationFormStatus.COMPLETE,
          formData: '{"q":"a"}',
        },
      ]);

      await service.submitApplicationPackage(PACKAGE_ID, USER_ID);

      expect(mockSiebel.createFormAttachment).toHaveBeenCalledWith(
        SR_ID,
        expect.objectContaining({
          fileName: `Jane_Doe-${ApplicationFormType.DISCLOSURECONSENT}`,
        }),
      );
    });

    it('falls back to the form type as filename when the member user cannot be found', async () => {
      mockUsers.findOne.mockImplementation((id: string) =>
        id === MEMBER_USER_ID ? null : primaryUser,
      );
      mockForms.findAllByApplicationPackageId.mockResolvedValue([
        {
          ...formBase,
          userId: MEMBER_USER_ID,
          type: ApplicationFormType.PCCCONSENT,
          status: ApplicationFormStatus.COMPLETE,
          formData: '{"q":"a"}',
        },
      ]);

      await service.submitApplicationPackage(PACKAGE_ID, USER_ID);

      expect(mockSiebel.createFormAttachment).toHaveBeenCalledWith(
        SR_ID,
        expect.objectContaining({ fileName: ApplicationFormType.PCCCONSENT }),
      );
      expect(testLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ userId: MEMBER_USER_ID }),
        'Could not find household member for screening form - using default filename',
      );
    });

    it('skips forms that were already attached to Siebel', async () => {
      mockForms.findAllByApplicationPackageId.mockResolvedValue([
        {
          ...formBase,
          type: ApplicationFormType.ABOUTME,
          status: ApplicationFormStatus.COMPLETE,
          formData: '{"q":"a"}',
          siebelAttachmentId: 'siebel-old',
        },
      ]);

      const result = await service.submitApplicationPackage(
        PACKAGE_ID,
        USER_ID,
      );

      expect(mockSiebel.createFormAttachment).not.toHaveBeenCalled();
      expect(mockForms.saveSiebelAttachmentId).not.toHaveBeenCalled();
      expect(result.isComplete).toBe(true);
    });

    it('skips forms with no form data', async () => {
      mockForms.findAllByApplicationPackageId.mockResolvedValue([
        {
          ...formBase,
          type: ApplicationFormType.ABOUTME,
          status: ApplicationFormStatus.COMPLETE,
          formData: undefined,
        },
      ]);

      const result = await service.submitApplicationPackage(
        PACKAGE_ID,
        USER_ID,
      );

      expect(mockSiebel.createFormAttachment).not.toHaveBeenCalled();
      expect(result.isComplete).toBe(true);
    });

    it('warns but continues when some forms fail to attach', async () => {
      mockForms.findAllByApplicationPackageId.mockResolvedValue([
        {
          applicationFormId: 'form-ok',
          householdMemberId: 'hm-self-1',
          type: ApplicationFormType.ABOUTME,
          status: ApplicationFormStatus.COMPLETE,
          formData: '{"q":"a"}',
        },
        {
          applicationFormId: 'form-bad',
          householdMemberId: 'hm-self-1',
          type: ApplicationFormType.HOUSEHOLD,
          status: ApplicationFormStatus.COMPLETE,
          formData: '{"q":"b"}',
        },
      ]);
      mockSiebel.createFormAttachment.mockImplementation(
        (_srId: string, payload: { fileName: string }) =>
          payload.fileName === 'About Me'
            ? Promise.resolve({ items: { Id: 'siebel-1' } })
            : Promise.reject(new Error('upload failed')),
      );

      const result = await service.submitApplicationPackage(
        PACKAGE_ID,
        USER_ID,
      );

      expect(result.isComplete).toBe(true);
      expect(testLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ failedAttachments: 1 }),
        'Some forms failed to attach to Siebel - submission continuing with partial attachments',
      );
    });
  });

  describe('submission completion', () => {
    it('marks the package SUBMITTED and sets the ICM application received flag', async () => {
      const result = await service.submitApplicationPackage(
        PACKAGE_ID,
        USER_ID,
      );

      expect(mockSiebel.updateServiceRequestFields).toHaveBeenCalledWith(
        SR_ID,
        {
          'ICM CGA Application Received Flag': 'Y',
        },
      );
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        { applicationPackageId: PACKAGE_ID },
        expect.objectContaining({
          status: ApplicationPackageStatus.SUBMITTED,
          srId: SR_ID,
        }),
      );
      expect(result).toEqual({ serviceRequestId: SR_ID, isComplete: true });
    });

    it('still marks the package SUBMITTED when the received-flag update fails', async () => {
      mockSiebel.updateServiceRequestFields.mockRejectedValue(
        new Error('flag update failed'),
      );

      const result = await service.submitApplicationPackage(
        PACKAGE_ID,
        USER_ID,
      );

      expect(result.isComplete).toBe(true);
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        { applicationPackageId: PACKAGE_ID },
        expect.objectContaining({ status: ApplicationPackageStatus.SUBMITTED }),
      );
    });

    it('rethrows NotFoundException untouched', async () => {
      mockHousehold.findAllHouseholdMembers.mockRejectedValue(
        new NotFoundException('nope'),
      );

      await expect(
        service.submitApplicationPackage(PACKAGE_ID, USER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('wraps unexpected errors in InternalServerErrorException', async () => {
      mockHousehold.findAllHouseholdMembers.mockRejectedValue(
        new Error('db down'),
      );

      await expect(
        service.submitApplicationPackage(PACKAGE_ID, USER_ID),
      ).rejects.toThrow(
        new InternalServerErrorException(
          'Failed to submit application package',
        ),
      );
    });
  });
});

describe('ApplicationPackageService - uploadMedicalAssessments', () => {
  let service: ApplicationPackageService;

  const PACKAGE_ID = 'pkg-med-001';
  const USER_ID = 'user-med-001';
  const SR_ID = 'sr-med-001';

  const mockModel = { findOne: jest.fn(), findOneAndUpdate: jest.fn() };
  const mockAttachments = {
    findByApplicationPackageId: jest.fn(),
    findById: jest.fn(),
  };
  const mockSiebel = { createAttachment: jest.fn() };

  const medicalPackage = {
    applicationPackageId: PACKAGE_ID,
    userId: USER_ID,
    srId: SR_ID,
  };

  const fullAttachment = (id: string): Record<string, unknown> => ({
    attachmentId: id,
    attachmentType: AttachmentType.MEDICAL_ASSESSMENT,
    fileName: `${id}.pdf`,
    fileData: Buffer.from('file'),
    fileType: 'pdf',
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockModel.findOne.mockReturnValue(queryFor(medicalPackage));
    mockModel.findOneAndUpdate.mockReturnValue(queryFor(medicalPackage));
    mockAttachments.findByApplicationPackageId.mockResolvedValue([
      {
        attachmentId: 'att-1',
        attachmentType: AttachmentType.MEDICAL_ASSESSMENT,
      },
      {
        attachmentId: 'att-2',
        attachmentType: AttachmentType.MEDICAL_ASSESSMENT,
      },
      { attachmentId: 'att-3', attachmentType: AttachmentType.OTHER },
    ]);
    mockAttachments.findById.mockImplementation((id: string) =>
      queryFor(fullAttachment(id)),
    );
    mockSiebel.createAttachment.mockResolvedValue({ items: { Id: 'icm-1' } });
    service = await compileService({
      model: mockModel,
      attachments: mockAttachments,
      siebel: mockSiebel,
    });
  });

  it('throws NotFoundException when the package is not found', async () => {
    mockModel.findOne.mockReturnValue(queryFor(null));

    await expect(
      service.uploadMedicalAssessments(PACKAGE_ID, USER_ID),
    ).rejects.toThrow(
      new NotFoundException(`Application package ${PACKAGE_ID} not found`),
    );
  });

  it('throws BadRequestException when there is no service request yet', async () => {
    mockModel.findOne.mockReturnValue(
      queryFor({ ...medicalPackage, srId: undefined }),
    );

    await expect(
      service.uploadMedicalAssessments(PACKAGE_ID, USER_ID),
    ).rejects.toThrow(
      new BadRequestException(
        'Service request not created yet - cannot upload medical assessments',
      ),
    );
  });

  it('throws BadRequestException when there are no medical assessment attachments', async () => {
    mockAttachments.findByApplicationPackageId.mockResolvedValue([
      { attachmentId: 'att-3', attachmentType: AttachmentType.OTHER },
    ]);

    await expect(
      service.uploadMedicalAssessments(PACKAGE_ID, USER_ID),
    ).rejects.toThrow(
      new BadRequestException(
        'No medical assessment attachments found for this application',
      ),
    );
  });

  it('uploads each medical attachment and marks the package', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 8, 4));
    try {
      const result = await service.uploadMedicalAssessments(
        PACKAGE_ID,
        USER_ID,
      );

      expect(mockSiebel.createAttachment).toHaveBeenCalledTimes(2);
      expect(mockSiebel.createAttachment).toHaveBeenCalledWith(
        SR_ID,
        expect.objectContaining({
          fileName: 'att-1.pdf',
          category: 'Medical',
          description: 'Medical Assessment Form',
        }),
      );
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        { applicationPackageId: PACKAGE_ID },
        {
          $set: { hasMedicalAssessment: true, updatedAt: new Date(2026, 8, 4) },
        },
        { new: true },
      );
      expect(result).toEqual({ success: true, attachmentsUploaded: 2 });
    } finally {
      jest.useRealTimers();
    }
  });

  it('skips attachments without file content', async () => {
    mockAttachments.findById.mockImplementation((id: string) =>
      queryFor({ ...fullAttachment(id), fileData: null }),
    );

    const result = await service.uploadMedicalAssessments(PACKAGE_ID, USER_ID);

    expect(mockSiebel.createAttachment).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, attachmentsUploaded: 0 });
  });

  it('throws InternalServerErrorException when an upload fails', async () => {
    mockSiebel.createAttachment.mockRejectedValue(new Error('Siebel down'));

    await expect(
      service.uploadMedicalAssessments(PACKAGE_ID, USER_ID),
    ).rejects.toThrow(
      new InternalServerErrorException('Failed to upload medical assessment'),
    );
  });
});

describe('ApplicationPackageService - submitTrainingCertificates', () => {
  let service: ApplicationPackageService;

  const PACKAGE_ID = 'pkg-train-001';
  const USER_ID = 'user-train-001';
  const SR_ID = 'sr-train-001';

  const mockModel = { findOne: jest.fn(), findOneAndUpdate: jest.fn() };
  const mockAttachments = {
    findByApplicationPackageId: jest.fn(),
    findById: jest.fn(),
    saveIcmAttachmentId: jest.fn(),
  };
  const mockSiebel = {
    createAttachment: jest.fn(),
    getIcmServiceRequestById: jest.fn(),
    createSRNotification: jest.fn(),
  };

  const trainingPackage = {
    applicationPackageId: PACKAGE_ID,
    userId: USER_ID,
    srId: SR_ID,
  };

  const assignedSr = {
    'Assigned To': 'John',
    'Assigned To Id': 'assignee-1',
    'Service Request Number': 'SR-123',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockModel.findOne.mockReturnValue(queryFor(trainingPackage));
    mockModel.findOneAndUpdate.mockReturnValue(queryFor(trainingPackage));
    mockAttachments.findByApplicationPackageId.mockResolvedValue([
      {
        attachmentId: 'att-1',
        attachmentType: AttachmentType.TRAINING_CERTIFICATE,
      },
    ]);
    mockAttachments.findById.mockResolvedValue({
      attachmentId: 'att-1',
      fileName: 'pride.pdf',
      fileData: Buffer.from('file'),
      fileType: 'pdf',
    });
    mockAttachments.saveIcmAttachmentId.mockResolvedValue(undefined);
    mockSiebel.createAttachment.mockResolvedValue({ items: { Id: 'icm-1' } });
    mockSiebel.getIcmServiceRequestById.mockResolvedValue(assignedSr);
    mockSiebel.createSRNotification.mockResolvedValue(undefined);
    service = await compileService({
      model: mockModel,
      attachments: mockAttachments,
      siebel: mockSiebel,
    });
  });

  it('throws NotFoundException when the package is not found', async () => {
    mockModel.findOne.mockReturnValue(queryFor(null));

    await expect(
      service.submitTrainingCertificates(PACKAGE_ID, USER_ID),
    ).rejects.toThrow(
      new NotFoundException(`Application package ${PACKAGE_ID} not found`),
    );
  });

  it('throws BadRequestException when there is no service request yet', async () => {
    mockModel.findOne.mockReturnValue(
      queryFor({ ...trainingPackage, srId: undefined }),
    );

    await expect(
      service.submitTrainingCertificates(PACKAGE_ID, USER_ID),
    ).rejects.toThrow(
      new BadRequestException(
        'Service request not created yet — cannot submit training certificates',
      ),
    );
  });

  it('throws BadRequestException when there are no pending certificates', async () => {
    mockAttachments.findByApplicationPackageId.mockResolvedValue([
      {
        attachmentId: 'att-1',
        attachmentType: AttachmentType.TRAINING_CERTIFICATE,
        icmAttachmentId: 'submitted-123',
      },
    ]);

    await expect(
      service.submitTrainingCertificates(PACKAGE_ID, USER_ID),
    ).rejects.toThrow(
      new BadRequestException(
        'No training certificate attachments found to submit',
      ),
    );
  });

  it('uploads certificates with the training category and marks the package', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 8, 4));
    try {
      const result = await service.submitTrainingCertificates(
        PACKAGE_ID,
        USER_ID,
      );

      expect(mockSiebel.createAttachment).toHaveBeenCalledWith(
        SR_ID,
        expect.objectContaining({
          fileName: 'pride.pdf',
          category: 'Resource Case',
          subCategory: 'Training Certificate',
          description: 'PRESERVICE CERTIFICATE',
        }),
      );
      expect(mockAttachments.saveIcmAttachmentId).toHaveBeenCalledWith(
        'att-1',
        expect.stringMatching(/^submitted-/),
      );
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        { applicationPackageId: PACKAGE_ID },
        {
          $set: {
            hasTrainingCertificates: true,
            updatedAt: new Date(2026, 8, 4),
          },
        },
        { new: true },
      );
      expect(result.success).toBe(true);
      expect(result.attachmentsUploaded).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('skips certificates without file content', async () => {
    mockAttachments.findById.mockResolvedValue({
      attachmentId: 'att-1',
      fileName: 'pride.pdf',
      fileData: null,
    });

    const result = await service.submitTrainingCertificates(
      PACKAGE_ID,
      USER_ID,
    );

    expect(mockSiebel.createAttachment).not.toHaveBeenCalled();
    expect(result.attachmentsUploaded).toBe(0);
  });

  it('throws InternalServerErrorException when an upload fails', async () => {
    mockSiebel.createAttachment.mockRejectedValue(new Error('Siebel down'));

    await expect(
      service.submitTrainingCertificates(PACKAGE_ID, USER_ID),
    ).rejects.toThrow(
      new InternalServerErrorException(
        'Failed to upload training certificate to ICM',
      ),
    );
  });

  it('sends the SR notification and reports it when the SR is assigned', async () => {
    const result = await service.submitTrainingCertificates(
      PACKAGE_ID,
      USER_ID,
    );

    expect(mockSiebel.createSRNotification).toHaveBeenCalledWith(SR_ID, {
      serviceRequestNumber: 'SR-123',
      owner: 'assignee-1',
      description:
        'Caregiver Applicant has submitted PRIDE training certificate(s) (SR-123)',
      assignedTo: 'John',
    });
    expect(result.notificationSent).toBe(true);
  });

  it('does not notify when the SR is missing in ICM', async () => {
    mockSiebel.getIcmServiceRequestById.mockResolvedValue(null);

    const result = await service.submitTrainingCertificates(
      PACKAGE_ID,
      USER_ID,
    );

    expect(mockSiebel.createSRNotification).not.toHaveBeenCalled();
    expect(result.notificationSent).toBe(false);
  });

  it('does not notify when the SR is unassigned', async () => {
    mockSiebel.getIcmServiceRequestById.mockResolvedValue({
      'Service Request Number': 'SR-123',
    });

    const result = await service.submitTrainingCertificates(
      PACKAGE_ID,
      USER_ID,
    );

    expect(mockSiebel.createSRNotification).not.toHaveBeenCalled();
    expect(result.notificationSent).toBe(false);
  });

  it('still succeeds on a Siebel connectivity failure while notifying', async () => {
    mockSiebel.getIcmServiceRequestById.mockRejectedValue(
      new SiebelApiError('socket hang up'),
    );

    const result = await service.submitTrainingCertificates(
      PACKAGE_ID,
      USER_ID,
    );

    expect(result.success).toBe(true);
    expect(result.notificationSent).toBe(false);
    expect(testLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ srId: SR_ID }),
      'Siebel connectivity failure; skipping notification — certificates were uploaded',
    );
  });
});

describe('ApplicationPackageService - submitInServiceTraining', () => {
  let service: ApplicationPackageService;

  const USER_ID = 'user-insvc-001';
  const RESOURCE_CASE_ID = 'case-001';
  const CONTACT_ID = 'contact-001';

  const mockUsers = { findOne: jest.fn() };
  const mockAttachments = {
    findByResourceCaseId: jest.fn(),
    findById: jest.fn(),
    saveIcmAttachmentId: jest.fn(),
  };
  const mockSiebel = {
    createCaseAttachment: jest.fn(),
    getOpenResourceCasesByContactId: jest.fn(),
    createCaseNotification: jest.fn(),
  };

  const user = {
    id: USER_ID,
    resource_case_id: RESOURCE_CASE_ID,
    contact_id: CONTACT_ID,
  };

  const assignedCase = {
    Id: RESOURCE_CASE_ID,
    'Assigned To': 'Jane',
    'Assigned To Id': 'owner-1',
    'Case Num': 'C-100',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockUsers.findOne.mockResolvedValue(user);
    mockAttachments.findByResourceCaseId.mockResolvedValue([
      {
        attachmentId: 'att-1',
        attachmentType: AttachmentType.IN_SERVICE_TRAINING_CERTIFICATE,
      },
    ]);
    mockAttachments.findById.mockResolvedValue({
      attachmentId: 'att-1',
      fileName: 'inservice.pdf',
      fileData: Buffer.from('file'),
      fileType: 'pdf',
    });
    mockAttachments.saveIcmAttachmentId.mockResolvedValue(undefined);
    mockSiebel.createCaseAttachment.mockResolvedValue({
      items: { Id: 'icm-1' },
    });
    mockSiebel.getOpenResourceCasesByContactId.mockResolvedValue([
      assignedCase,
    ]);
    mockSiebel.createCaseNotification.mockResolvedValue(undefined);
    service = await compileService({
      users: mockUsers,
      attachments: mockAttachments,
      siebel: mockSiebel,
    });
  });

  it('throws BadRequestException when the user has no active resource case', async () => {
    mockUsers.findOne.mockResolvedValue({ id: USER_ID });

    await expect(service.submitInServiceTraining(USER_ID)).rejects.toThrow(
      new BadRequestException('No active resource case found for this user'),
    );
  });

  it('throws BadRequestException when there are no pending in-service certificates', async () => {
    mockAttachments.findByResourceCaseId.mockResolvedValue([
      {
        attachmentId: 'att-1',
        attachmentType: AttachmentType.TRAINING_CERTIFICATE,
      },
    ]);

    await expect(service.submitInServiceTraining(USER_ID)).rejects.toThrow(
      new BadRequestException(
        'No in-service training certificate attachments found to submit',
      ),
    );
  });

  it('uploads certificates to the resource case and notifies the assignee', async () => {
    const result = await service.submitInServiceTraining(USER_ID);

    expect(mockSiebel.createCaseAttachment).toHaveBeenCalledWith(
      RESOURCE_CASE_ID,
      expect.objectContaining({
        fileName: 'inservice.pdf',
        category: 'Resource Case',
        subCategory: 'Training Certificate',
        description: 'In-Service Training Certificate',
      }),
    );
    expect(mockAttachments.saveIcmAttachmentId).toHaveBeenCalledWith(
      'att-1',
      expect.stringMatching(/^submitted-/),
    );
    expect(mockSiebel.createCaseNotification).toHaveBeenCalledWith(
      RESOURCE_CASE_ID,
      expect.objectContaining({
        owner: 'owner-1',
        assignedTo: 'Jane',
        caseNumber: 'C-100',
      }),
    );
    expect(result).toEqual({
      success: true,
      attachmentsUploaded: 1,
      notificationSent: true,
    });
  });

  it('skips the notification when the user has no contact id', async () => {
    mockUsers.findOne.mockResolvedValue({
      id: USER_ID,
      resource_case_id: RESOURCE_CASE_ID,
    });

    const result = await service.submitInServiceTraining(USER_ID);

    expect(mockSiebel.getOpenResourceCasesByContactId).not.toHaveBeenCalled();
    expect(result.notificationSent).toBe(false);
  });

  it('skips the notification when the resource case is not found in ICM', async () => {
    mockSiebel.getOpenResourceCasesByContactId.mockResolvedValue([
      { Id: 'case-other' },
    ]);

    const result = await service.submitInServiceTraining(USER_ID);

    expect(mockSiebel.createCaseNotification).not.toHaveBeenCalled();
    expect(result.notificationSent).toBe(false);
  });

  it('skips the notification when the case has no assignee', async () => {
    mockSiebel.getOpenResourceCasesByContactId.mockResolvedValue([
      { Id: RESOURCE_CASE_ID, 'Case Num': 'C-100' },
    ]);

    const result = await service.submitInServiceTraining(USER_ID);

    expect(mockSiebel.createCaseNotification).not.toHaveBeenCalled();
    expect(result.notificationSent).toBe(false);
  });

  it('still succeeds on a Siebel connectivity failure while notifying', async () => {
    mockSiebel.getOpenResourceCasesByContactId.mockRejectedValue(
      new SiebelApiError('socket hang up'),
    );

    const result = await service.submitInServiceTraining(USER_ID);

    expect(result.success).toBe(true);
    expect(result.notificationSent).toBe(false);
    expect(testLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ resourceCaseId: RESOURCE_CASE_ID }),
      'Siebel connectivity failure; skipping notification — certificates were uploaded',
    );
  });

  it('throws InternalServerErrorException when an upload fails', async () => {
    mockSiebel.createCaseAttachment.mockRejectedValue(new Error('Siebel down'));

    await expect(service.submitInServiceTraining(USER_ID)).rejects.toThrow(
      new InternalServerErrorException(
        'Failed to upload in-service training certificate to ICM',
      ),
    );
  });
});

describe('ApplicationPackageService - validateHouseholdCompletion', () => {
  let service: ApplicationPackageService;

  const mockModel = { findOne: jest.fn() };
  const mockHousehold = { validateHouseholdCompletion: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockModel.findOne.mockReturnValue(
      queryFor({
        applicationPackageId: 'pkg-1',
        userId: 'user-1',
        hasPartner: true,
        hasHousehold: false,
      }),
    );
    mockHousehold.validateHouseholdCompletion.mockResolvedValue({
      complete: true,
    });
    service = await compileService({
      model: mockModel,
      household: mockHousehold,
    });
  });

  it('throws NotFoundException when the user does not own the package', async () => {
    mockModel.findOne.mockReturnValue(queryFor(null));

    await expect(
      service.validateHouseholdCompletion('pkg-1', 'user-1'),
    ).rejects.toThrow(
      new NotFoundException(
        'Application package pkg-1 not found or not owned by user',
      ),
    );
  });

  it('delegates to the household service with the household flags', async () => {
    const result = await service.validateHouseholdCompletion('pkg-1', 'user-1');

    expect(mockHousehold.validateHouseholdCompletion).toHaveBeenCalledWith(
      'pkg-1',
      true,
      false,
    );
    expect(result).toEqual({ complete: true });
  });
});
