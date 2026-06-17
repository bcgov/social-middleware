import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BcscSyncService } from '../services/bcsc-sync.service';
import { ApplicationPackage } from '../schema/application-package.schema';
import { ApplicationPackageStatus } from '../enums/application-package-status.enum';
import { ApplicationPackageSubType } from '../enums/application-package-subtypes.enum';
import { ApplicationFormStatus } from '../../application-form/enums/application-form-status.enum';
import { ApplicationFormType } from '../../application-form/enums/application-form-types.enum';
import { HouseholdService } from '../../household/services/household.service';
import { ApplicationFormService } from '../../application-form/services/application-form.service';
import { ApplicationForm } from '../../application-form/schemas/application-form.schema';
import { UserService } from '../../auth/user.service';
import { User } from '../../auth/schemas/user.schema';
import { HouseholdMembersDocument } from '../../household/schemas/household-members.schema';

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  setContext: jest.fn(),
};

const mockUser: User = {
  id: 'user-001',
  bc_services_card_id: 'did-123',
  first_name: 'Jane',
  last_name: 'Doe',
  email: 'jane@example.com',
  dateOfBirth: '1990-01-01',
  street_address: '123 Main St',
  city: 'Victoria',
  region: 'BC',
  country: 'Canada',
  postal_code: 'V8V 1A1',
  contact_id: '',
  last_login: new Date(),
  status: 'active',
  bcsc_update_pending: false,
};

const mockPrimaryApplicant = {
  householdMemberId: 'hm-001',
  userId: 'user-001',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  dateOfBirth: '1990-01-01',
  genderType: 'Unspecified',
} as unknown as HouseholdMembersDocument;

const makePkg = (
  overrides: Partial<ApplicationPackage> = {},
): Partial<ApplicationPackage> => ({
  applicationPackageId: 'pkg-001',
  userId: 'user-001',
  status: ApplicationPackageStatus.DRAFT,
  subtype: ApplicationPackageSubType.FCH,
  ...overrides,
});

const makeForm = (
  type: ApplicationFormType,
  status: ApplicationFormStatus,
  applicationFormId = `form-${type}`,
) => ({ applicationFormId, type, status }) as unknown as ApplicationForm;

describe('BcscSyncService', () => {
  let service: BcscSyncService;
  let mockExec: jest.Mock;
  let householdService: jest.Mocked<
    Pick<HouseholdService, 'findPrimaryApplicant' | 'updateHouseholdMember'>
  >;
  let applicationFormService: jest.Mocked<
    Pick<ApplicationFormService, 'findByPackageAndUser' | 'updateFormStatus'>
  >;
  let userService: jest.Mocked<Pick<UserService, 'findOne' | 'updateUser'>>;

  beforeEach(async () => {
    mockExec = jest.fn().mockResolvedValue([]);

    householdService = {
      findPrimaryApplicant: jest.fn().mockResolvedValue(mockPrimaryApplicant),
      updateHouseholdMember: jest.fn().mockResolvedValue(mockPrimaryApplicant),
    };

    applicationFormService = {
      findByPackageAndUser: jest.fn().mockResolvedValue([]),
      updateFormStatus: jest.fn().mockResolvedValue(undefined),
    };

    userService = {
      findOne: jest.fn().mockResolvedValue(mockUser),
      updateUser: jest.fn().mockResolvedValue(mockUser),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BcscSyncService,
        {
          provide: getModelToken(ApplicationPackage.name),
          useValue: {
            find: jest.fn().mockReturnValue({
              lean: jest.fn().mockReturnValue({ exec: mockExec }),
            }),
          },
        },
        { provide: HouseholdService, useValue: householdService },
        { provide: ApplicationFormService, useValue: applicationFormService },
        { provide: UserService, useValue: userService },
        { provide: 'PinoLogger:BcscSyncService', useValue: mockLogger },
      ],
    }).compile();

    service = module.get<BcscSyncService>(BcscSyncService);
    jest.clearAllMocks();
    userService.findOne.mockResolvedValue(mockUser);
    householdService.findPrimaryApplicant.mockResolvedValue(
      mockPrimaryApplicant,
    );
    householdService.updateHouseholdMember.mockResolvedValue(
      mockPrimaryApplicant,
    );
    applicationFormService.findByPackageAndUser.mockResolvedValue([]);
    applicationFormService.updateFormStatus.mockResolvedValue(undefined);
    userService.updateUser.mockResolvedValue(mockUser);
  });

  describe('syncOnLogin', () => {
    it('returns early and makes no updates when user has no qualifying packages', async () => {
      mockExec.mockResolvedValue([]);

      await service.syncOnLogin('user-001');

      expect(householdService.updateHouseholdMember).not.toHaveBeenCalled();
      expect(userService.updateUser).not.toHaveBeenCalled();
    });

    it('updates the primary household member for a Draft package', async () => {
      mockExec.mockResolvedValue([
        makePkg({ status: ApplicationPackageStatus.DRAFT }),
      ]);

      await service.syncOnLogin('user-001');

      expect(householdService.updateHouseholdMember).toHaveBeenCalledWith(
        'hm-001',
        expect.objectContaining({
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@example.com',
          dateOfBirth: '1990-01-01',
        }),
      );
    });

    it('does not reset forms or set bcsc_update_pending for a Draft package', async () => {
      mockExec.mockResolvedValue([
        makePkg({ status: ApplicationPackageStatus.DRAFT }),
      ]);

      await service.syncOnLogin('user-001');

      expect(
        applicationFormService.findByPackageAndUser,
      ).not.toHaveBeenCalled();
      expect(userService.updateUser).not.toHaveBeenCalled();
    });

    it('resets databinding forms for a foster REFERRAL package', async () => {
      mockExec.mockResolvedValue([
        makePkg({
          status: ApplicationPackageStatus.REFERRAL,
          subtype: ApplicationPackageSubType.FCH,
        }),
      ]);
      applicationFormService.findByPackageAndUser.mockResolvedValue([
        makeForm(ApplicationFormType.ABOUTME, ApplicationFormStatus.COMPLETE),
        makeForm(ApplicationFormType.PCCCONSENT, ApplicationFormStatus.DRAFT),
        makeForm(
          ApplicationFormType.DISCLOSURECONSENT,
          ApplicationFormStatus.COMPLETE,
        ),
      ]);

      await service.syncOnLogin('user-001');

      expect(applicationFormService.updateFormStatus).toHaveBeenCalledTimes(3);
      expect(applicationFormService.updateFormStatus).toHaveBeenCalledWith(
        `form-${ApplicationFormType.ABOUTME}`,
        ApplicationFormStatus.NEW,
      );
      expect(applicationFormService.updateFormStatus).toHaveBeenCalledWith(
        `form-${ApplicationFormType.PCCCONSENT}`,
        ApplicationFormStatus.NEW,
      );
      expect(applicationFormService.updateFormStatus).toHaveBeenCalledWith(
        `form-${ApplicationFormType.DISCLOSURECONSENT}`,
        ApplicationFormStatus.NEW,
      );
    });

    it('sets bcsc_update_pending for a foster REFERRAL package', async () => {
      mockExec.mockResolvedValue([
        makePkg({
          status: ApplicationPackageStatus.REFERRAL,
          subtype: ApplicationPackageSubType.FCH,
        }),
      ]);

      await service.syncOnLogin('user-001');

      expect(userService.updateUser).toHaveBeenCalledWith('user-001', {
        bcsc_update_pending: true,
      });
    });

    it('resets databinding forms for a foster APPLICATION package', async () => {
      mockExec.mockResolvedValue([
        makePkg({
          status: ApplicationPackageStatus.APPLICATION,
          subtype: ApplicationPackageSubType.FCH,
        }),
      ]);
      applicationFormService.findByPackageAndUser.mockResolvedValue([
        makeForm(ApplicationFormType.ABOUTME, ApplicationFormStatus.COMPLETE),
      ]);

      await service.syncOnLogin('user-001');

      expect(applicationFormService.updateFormStatus).toHaveBeenCalledWith(
        `form-${ApplicationFormType.ABOUTME}`,
        ApplicationFormStatus.NEW,
      );
      expect(userService.updateUser).toHaveBeenCalledWith('user-001', {
        bcsc_update_pending: true,
      });
    });

    it('resets databinding forms for a kinship APPLICATION package but does not set bcsc_update_pending', async () => {
      mockExec.mockResolvedValue([
        makePkg({
          status: ApplicationPackageStatus.APPLICATION,
          subtype: ApplicationPackageSubType.OOC,
        }),
      ]);
      applicationFormService.findByPackageAndUser.mockResolvedValue([
        makeForm(ApplicationFormType.ABOUTME, ApplicationFormStatus.COMPLETE),
      ]);

      await service.syncOnLogin('user-001');

      expect(applicationFormService.updateFormStatus).toHaveBeenCalled();
      expect(userService.updateUser).not.toHaveBeenCalled();
    });

    it('does not reset a databinding form that is already New', async () => {
      mockExec.mockResolvedValue([
        makePkg({ status: ApplicationPackageStatus.REFERRAL }),
      ]);
      applicationFormService.findByPackageAndUser.mockResolvedValue([
        makeForm(ApplicationFormType.ABOUTME, ApplicationFormStatus.NEW),
        makeForm(
          ApplicationFormType.PCCCONSENT,
          ApplicationFormStatus.COMPLETE,
        ),
      ]);

      await service.syncOnLogin('user-001');

      expect(applicationFormService.updateFormStatus).toHaveBeenCalledTimes(1);
      expect(applicationFormService.updateFormStatus).toHaveBeenCalledWith(
        `form-${ApplicationFormType.PCCCONSENT}`,
        ApplicationFormStatus.NEW,
      );
    });

    it('does not reset non-databinding forms', async () => {
      mockExec.mockResolvedValue([
        makePkg({ status: ApplicationPackageStatus.REFERRAL }),
      ]);
      applicationFormService.findByPackageAndUser.mockResolvedValue([
        makeForm(
          ApplicationFormType.REFERENCES,
          ApplicationFormStatus.COMPLETE,
        ),
        makeForm(ApplicationFormType.CHILDREN, ApplicationFormStatus.COMPLETE),
        makeForm(ApplicationFormType.ABOUTME, ApplicationFormStatus.COMPLETE),
      ]);

      await service.syncOnLogin('user-001');

      expect(applicationFormService.updateFormStatus).toHaveBeenCalledTimes(1);
      expect(applicationFormService.updateFormStatus).toHaveBeenCalledWith(
        `form-${ApplicationFormType.ABOUTME}`,
        ApplicationFormStatus.NEW,
      );
    });

    it('sets bcsc_update_pending only once when multiple foster packages qualify', async () => {
      mockExec.mockResolvedValue([
        makePkg({
          applicationPackageId: 'pkg-001',
          status: ApplicationPackageStatus.REFERRAL,
        }),
        makePkg({
          applicationPackageId: 'pkg-002',
          status: ApplicationPackageStatus.APPLICATION,
        }),
      ]);

      await service.syncOnLogin('user-001');

      expect(userService.updateUser).toHaveBeenCalledTimes(1);
      expect(userService.updateUser).toHaveBeenCalledWith('user-001', {
        bcsc_update_pending: true,
      });
    });

    it('processes all packages when one package has no primary applicant', async () => {
      mockExec.mockResolvedValue([
        makePkg({
          applicationPackageId: 'pkg-001',
          status: ApplicationPackageStatus.DRAFT,
        }),
        makePkg({
          applicationPackageId: 'pkg-002',
          status: ApplicationPackageStatus.DRAFT,
        }),
      ]);
      householdService.findPrimaryApplicant
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockPrimaryApplicant);

      await service.syncOnLogin('user-001');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ applicationPackageId: 'pkg-001' }),
        expect.stringContaining('No primary applicant'),
      );
      expect(householdService.updateHouseholdMember).toHaveBeenCalledTimes(1);
    });

    it('continues processing remaining packages when one package throws', async () => {
      mockExec.mockResolvedValue([
        makePkg({
          applicationPackageId: 'pkg-001',
          status: ApplicationPackageStatus.DRAFT,
        }),
        makePkg({
          applicationPackageId: 'pkg-002',
          status: ApplicationPackageStatus.DRAFT,
        }),
      ]);
      householdService.updateHouseholdMember
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce(mockPrimaryApplicant);

      await service.syncOnLogin('user-001');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ applicationPackageId: 'pkg-001' }),
        expect.any(String),
      );
      expect(householdService.updateHouseholdMember).toHaveBeenCalledTimes(2);
    });
  });
});
