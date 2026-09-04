import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { AccessCodeType } from '../../household/enums/access-code-type.enum';
import { RelationshipToPrimary } from '../../household/enums/relationship-to-primary.enum';
import { AccessCodeService } from '../../household/services/access-code.service';
import { HouseholdService } from '../../household/services/household.service';
import { NotificationService } from '../../notifications/services/notification.service';
import { SiebelApiService } from '../../siebel/siebel-api.service';
import {
  ApplicationPackageStatus,
  ServiceRequestStage,
} from '../enums/application-package-status.enum';
import {
  ApplicationPackageSubSubType,
  ApplicationPackageSubType,
} from '../enums/application-package-subtypes.enum';
import { ProspectiveCaregiver } from '../interfaces/prospective-caregiver.interface';
import { ApplicationPackage } from '../schema/application-package.schema';
import { CaregiverInvitationService } from '../services/caregiver-invitation.service';

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

describe('CaregiverInvitationService', () => {
  let service: CaregiverInvitationService;

  const mockFindOne = jest.fn();
  const mockCreate = jest.fn();

  const mockHouseholdService = {
    createMember: jest.fn(),
    findPrimaryApplicant: jest.fn(),
  };
  const mockAccessCodeService = {
    createAccessCode: jest.fn(),
    resendOrCreateAccessCode: jest.fn(),
  };
  const mockNotificationService = { sendCaregiverInvitation: jest.fn() };
  const mockSiebelApiService = {
    getNewKinshipSRsForProspectiveCaregivers: jest.fn(),
    getIcmContactById: jest.fn(),
  };

  const mockCaregiver: ProspectiveCaregiver = {
    firstName: 'Jane',
    lastName: 'Doe',
    dateOfBirth: '1990-01-15',
    email: 'jane.doe@example.com',
    contactId: 'icm-contact-001',
    srId: 'sr-001',
    subtype: ApplicationPackageSubType.OOC,
    subsubtype: ApplicationPackageSubSubType._BLANK,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    mockCreate.mockResolvedValue({});
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CaregiverInvitationService,
        {
          provide: getModelToken(ApplicationPackage.name),
          useValue: { findOne: mockFindOne, create: mockCreate },
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

  describe('processProspectiveCaregiver', () => {
    describe('when already redeemed', () => {
      it('skips all steps if a package exists with a userId set', async () => {
        mockFindOne.mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            applicationPackageId: 'existing-pkg',
            userId: 'user-001',
          }),
        });

        await service.processProspectiveCaregiver(mockCaregiver);

        expect(mockCreate).not.toHaveBeenCalled();
        expect(
          mockHouseholdService.findPrimaryApplicant,
        ).not.toHaveBeenCalled();
        expect(mockAccessCodeService.createAccessCode).not.toHaveBeenCalled();
        expect(
          mockAccessCodeService.resendOrCreateAccessCode,
        ).not.toHaveBeenCalled();
        expect(
          mockNotificationService.sendCaregiverInvitation,
        ).not.toHaveBeenCalled();
      });
    });

    describe('when package exists but not redeemed', () => {
      beforeEach(() => {
        mockFindOne.mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            applicationPackageId: 'existing-pkg',
            userId: null,
          }),
        });
        mockHouseholdService.findPrimaryApplicant.mockResolvedValue({
          householdMemberId: 'hm-existing',
        });
      });

      it('does not send an email when the existing code is still valid', async () => {
        mockAccessCodeService.resendOrCreateAccessCode.mockResolvedValue({
          accessCode: 'ABCDEF',
          expiresAt: new Date(),
          isNew: false,
        });

        await service.processProspectiveCaregiver(mockCaregiver);

        expect(
          mockAccessCodeService.resendOrCreateAccessCode,
        ).toHaveBeenCalledWith(
          'hm-existing',
          'existing-pkg',
          AccessCodeType.NEW_APPLICATION,
        );
        expect(
          mockNotificationService.sendCaregiverInvitation,
        ).not.toHaveBeenCalled();
        expect(mockCreate).not.toHaveBeenCalled();
      });

      it('resends a new email when the existing code has expired', async () => {
        mockAccessCodeService.resendOrCreateAccessCode.mockResolvedValue({
          accessCode: 'NEWCODE',
          expiresAt: new Date(),
          isNew: true,
        });

        await service.processProspectiveCaregiver(mockCaregiver);

        expect(
          mockNotificationService.sendCaregiverInvitation,
        ).toHaveBeenCalledWith('jane.doe@example.com', 'Jane', 'NEWCODE');
      });

      it('does nothing further if no primary applicant household member is found', async () => {
        mockHouseholdService.findPrimaryApplicant.mockResolvedValue(null);

        await service.processProspectiveCaregiver(mockCaregiver);

        expect(
          mockAccessCodeService.resendOrCreateAccessCode,
        ).not.toHaveBeenCalled();
        expect(
          mockNotificationService.sendCaregiverInvitation,
        ).not.toHaveBeenCalled();
      });
    });

    describe('happy path — new caregiver', () => {
      it('creates an application package with srId and REFERRAL stage, no userId', async () => {
        await service.processProspectiveCaregiver(mockCaregiver);

        expect(mockCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            applicationPackageId: 'mock-package-uuid',
            userId: null,
            subtype: ApplicationPackageSubType.OOC,
            subsubtype: ApplicationPackageSubSubType._BLANK,
            status: ApplicationPackageStatus.DRAFT,
            contactId: 'icm-contact-001',
            srId: 'sr-001',
            srStage: ServiceRequestStage.REFERRAL,
          }),
        );
      });

      it('creates a primary household member from caregiver data', async () => {
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

      it('generates a NEW_APPLICATION access code for the new household member', async () => {
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
        ).toHaveBeenCalledWith(
          expect.any(String), // update to 'jane.doe@example.com' once the test-email override is removed
          'Jane',
          'ABCDEF',
        );
      });
    });
  });

  describe('pollKinshipReferrals', () => {
    const srResult = { Id: 'sr-001', 'Primary Contact Id': 'contact-001' };
    const contactResult = {
      Id: 'contact-001',
      'First Name': 'Jane',
      'Last Name': 'Doe',
      'Birth Date': '01/15/1990',
      'Primary Email': 'jane.doe@example.com',
    };

    beforeEach(() => {
      jest
        .spyOn(service, 'processProspectiveCaregiver')
        .mockResolvedValue(undefined);
    });

    it('logs and returns without throwing when the Siebel poll fails', async () => {
      mockSiebelApiService.getNewKinshipSRsForProspectiveCaregivers.mockRejectedValue(
        new Error('Siebel unavailable'),
      );

      await expect(service.pollKinshipReferrals()).resolves.toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalled();
      expect(service.processProspectiveCaregiver).not.toHaveBeenCalled();
    });

    it('does nothing when no SRs are returned', async () => {
      mockSiebelApiService.getNewKinshipSRsForProspectiveCaregivers.mockResolvedValue(
        [],
      );

      await service.pollKinshipReferrals();

      expect(service.processProspectiveCaregiver).not.toHaveBeenCalled();
    });

    it('skips an SR when the contact is not found', async () => {
      mockSiebelApiService.getNewKinshipSRsForProspectiveCaregivers.mockResolvedValue(
        [srResult],
      );
      mockSiebelApiService.getIcmContactById.mockResolvedValue(null);

      await service.pollKinshipReferrals();

      expect(service.processProspectiveCaregiver).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ srId: 'sr-001', contactId: 'contact-001' }),
        expect.stringContaining('Contact not found'),
      );
    });

    it('skips an SR when the contact has no Primary Email', async () => {
      mockSiebelApiService.getNewKinshipSRsForProspectiveCaregivers.mockResolvedValue(
        [srResult],
      );
      mockSiebelApiService.getIcmContactById.mockResolvedValue({
        ...contactResult,
        'Primary Email': '',
      });

      await service.pollKinshipReferrals();

      expect(service.processProspectiveCaregiver).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ srId: 'sr-001', contactId: 'contact-001' }),
        expect.stringContaining('no Primary Email'),
      );
    });

    it('converts MM/DD/YYYY birth date to ISO and calls processProspectiveCaregiver', async () => {
      mockSiebelApiService.getNewKinshipSRsForProspectiveCaregivers.mockResolvedValue(
        [srResult],
      );
      mockSiebelApiService.getIcmContactById.mockResolvedValue(contactResult);

      await service.pollKinshipReferrals();

      expect(service.processProspectiveCaregiver).toHaveBeenCalledWith(
        expect.objectContaining({
          firstName: 'Jane',
          lastName: 'Doe',
          dateOfBirth: '1990-01-15',
          email: 'jane.doe@example.com',
          contactId: 'contact-001',
          srId: 'sr-001',
          subtype: ApplicationPackageSubType.OOC,
          subsubtype: ApplicationPackageSubSubType._BLANK,
        }),
      );
    });

    it('continues processing remaining SRs if one fails', async () => {
      const secondSr = { Id: 'sr-002', 'Primary Contact Id': 'contact-002' };
      mockSiebelApiService.getNewKinshipSRsForProspectiveCaregivers.mockResolvedValue(
        [srResult, secondSr],
      );
      mockSiebelApiService.getIcmContactById
        .mockRejectedValueOnce(new Error('lookup failed'))
        .mockResolvedValueOnce(contactResult);

      await service.pollKinshipReferrals();

      expect(service.processProspectiveCaregiver).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});
