import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { CaregiverInvitationService } from '../services/caregiver-invitation.service';
import { ApplicationPackage } from '../schema/application-package.schema';
import { AccessCodeService } from '../../household/services/access-code.service';
import { HouseholdService } from '../../household/services/household.service';
import { NotificationService } from '../../notifications/services/notification.service';
import { SiebelApiService } from '../../siebel/siebel-api.service';
import { ApplicationPackageStatus } from '../enums/application-package-status.enum';
import { AccessCodeType } from '../../household/enums/access-code-type.enum';
import {
  ApplicationPackageSubType,
  ApplicationPackageSubSubType,
} from '../enums/application-package-subtypes.enum';
import { RelationshipToPrimary } from '../../household/enums/relationship-to-primary.enum';
import { ProspectiveCaregiver } from '../interfaces/prospective-caregiver.interface';

jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('mock-package-uuid'),
}));

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  setContext: jest.fn(),
};

describe('CaregiverInvitationService - processProspectiveCaregiver', () => {
  let service: CaregiverInvitationService;

  const mockFindOne = jest.fn();
  const mockCreate = jest.fn();
  const mockUpdateOne = jest.fn();

  const mockHouseholdService = { createMember: jest.fn() };
  const mockAccessCodeService = { createAccessCode: jest.fn() };
  const mockNotificationService = { sendCaregiverInvitation: jest.fn() };
  const mockSiebelApiService = { createCaregiverApplicationSR: jest.fn() };

  const mockCaregiver: ProspectiveCaregiver = {
    firstName: 'Jane',
    lastName: 'Doe',
    dateOfBirth: '1990-01-15',
    email: 'jane.doe@example.com',
    contactId: 'icm-contact-001',
    activityId: 'icm-activity-001',
    subtype: ApplicationPackageSubType.FCH,
    subsubtype: ApplicationPackageSubSubType.FCH,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    mockCreate.mockResolvedValue({});
    mockUpdateOne.mockResolvedValue({});
    mockHouseholdService.createMember.mockResolvedValue({
      householdMemberId: 'hm-new-001',
    });
    mockAccessCodeService.createAccessCode.mockResolvedValue({
      accessCode: 'ABCDEF',
      expiresAt: new Date(),
    });
    mockNotificationService.sendCaregiverInvitation.mockResolvedValue(
      undefined,
    );
    mockSiebelApiService.createCaregiverApplicationSR.mockResolvedValue({
      srId: 'sr-001',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CaregiverInvitationService,
        {
          provide: getModelToken(ApplicationPackage.name),
          useValue: {
            findOne: mockFindOne,
            create: mockCreate,
            updateOne: mockUpdateOne,
          },
        },
        { provide: AccessCodeService, useValue: mockAccessCodeService },
        { provide: HouseholdService, useValue: mockHouseholdService },
        { provide: SiebelApiService, useValue: mockSiebelApiService },
        { provide: NotificationService, useValue: mockNotificationService },
        {
          provide: 'PinoLogger:CaregiverInvitationService',
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get<CaregiverInvitationService>(
      CaregiverInvitationService,
    );
  });

  describe('idempotency', () => {
    it('skips all steps if a package already exists for the contactId and activityId', async () => {
      mockFindOne.mockReturnValue({
        lean: jest
          .fn()
          .mockResolvedValue({ applicationPackageId: 'existing-pkg' }),
      });

      await service.processProspectiveCaregiver(mockCaregiver);

      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockHouseholdService.createMember).not.toHaveBeenCalled();
      expect(mockAccessCodeService.createAccessCode).not.toHaveBeenCalled();
      expect(
        mockNotificationService.sendCaregiverInvitation,
      ).not.toHaveBeenCalled();
      expect(
        mockSiebelApiService.createCaregiverApplicationSR,
      ).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    it('creates an application package with correct fields and no userId', async () => {
      await service.processProspectiveCaregiver(mockCaregiver);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          applicationPackageId: 'mock-package-uuid',
          userId: null,
          subtype: ApplicationPackageSubType.FCH,
          subsubtype: ApplicationPackageSubSubType.FCH,
          status: ApplicationPackageStatus.DRAFT,
          contactId: 'icm-contact-001',
          activityId: 'icm-activity-001',
        }),
      );
    });

    it('creates a primary household member with caregiver contact data', async () => {
      await service.processProspectiveCaregiver(mockCaregiver);

      expect(mockHouseholdService.createMember).toHaveBeenCalledWith(
        expect.objectContaining({
          applicationPackageId: 'mock-package-uuid',
          firstName: 'Jane',
          lastName: 'Doe',
          dateOfBirth: '1990-01-15',
          email: 'jane.doe@example.com',
          relationshipToPrimary: RelationshipToPrimary.Self,
        }),
      );
    });

    it('generates a NEW_APPLICATION access code using the id returned by createMember', async () => {
      await service.processProspectiveCaregiver(mockCaregiver);

      expect(mockAccessCodeService.createAccessCode).toHaveBeenCalledWith(
        'hm-new-001',
        'mock-package-uuid',
        AccessCodeType.NEW_APPLICATION,
      );
    });

    it('sends the invitation email with the generated access code', async () => {
      await service.processProspectiveCaregiver(mockCaregiver);

      expect(
        mockNotificationService.sendCaregiverInvitation,
      ).toHaveBeenCalledWith('jane.doe@example.com', 'Jane', 'ABCDEF');
    });

    it('creates a Siebel SR with the correct subtype and contact/activity ids', async () => {
      await service.processProspectiveCaregiver(mockCaregiver);

      expect(
        mockSiebelApiService.createCaregiverApplicationSR,
      ).toHaveBeenCalledWith(
        ApplicationPackageSubType.FCH,
        ApplicationPackageSubSubType.FCH,
        '',
        'icm-contact-001',
        'icm-activity-001',
      );
    });

    it('stores the srId returned from Siebel on the application package', async () => {
      await service.processProspectiveCaregiver(mockCaregiver);

      expect(mockUpdateOne).toHaveBeenCalledWith(
        { applicationPackageId: 'mock-package-uuid' },
        { srId: 'sr-001' },
      );
    });
  });

  describe('error handling', () => {
    it('throws if Siebel SR creation fails', async () => {
      mockSiebelApiService.createCaregiverApplicationSR.mockRejectedValue(
        new Error('Siebel unavailable'),
      );

      await expect(
        service.processProspectiveCaregiver(mockCaregiver),
      ).rejects.toThrow('Siebel unavailable');
    });

    it('does not store srId if SR creation fails', async () => {
      mockSiebelApiService.createCaregiverApplicationSR.mockRejectedValue(
        new Error('Siebel unavailable'),
      );

      await expect(
        service.processProspectiveCaregiver(mockCaregiver),
      ).rejects.toThrow();

      expect(mockUpdateOne).not.toHaveBeenCalled();
    });
  });
});
