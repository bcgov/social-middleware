import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ApplicationPackageController } from '../application-package.controller';
import { ApplicationPackageService } from '../services/application-package.service';
import { SessionUtil } from 'src/common/utils/session.util';
import { ApplicationPackageStatus } from '../enums/application-package-status.enum';
import {
  ApplicationPackageSubType,
  ApplicationPackageSubSubType,
} from '../enums/application-package-subtypes.enum';
import { AttachmentType } from 'src/attachments/enums/attachment-types.enum';
import { Request } from 'express';
import { SessionAuthGuard } from 'src/auth/session-auth.guard';
import { PinoLogger } from 'nestjs-pino';
import { AccessCodeService } from 'src/household/services/access-code.service';
import { AccessCodeType } from 'src/household/enums/access-code-type.enum';
import { UserService } from 'src/auth/user.service';
import { SiebelApiService } from 'src/siebel/siebel-api.service';

describe('ApplicationPackageController', () => {
  let controller: ApplicationPackageController;

  const APPLICATION_PACKAGE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const USER_ID = 'user-001';

  const mockSessionUtil = {
    extractUserIdFromRequest: jest.fn().mockReturnValue(USER_ID),
  };

  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn(),
  };

  const mockAccessCodeService = {
    associateUserWithAccessCode: jest.fn(),
  };
  const mockUserService = {
    findOne: jest.fn(),
  };
  const mockSiebelApiService = {};

  const mockService = {
    createApplicationPackage: jest.fn(),
    updateApplicationPackage: jest.fn(),
    getApplicationPackages: jest.fn(),
    getApplicationPackage: jest.fn(),
    getApplicationFormsByPackageId: jest.fn(),
    cancelApplicationPackage: jest.fn(),
    validateHouseholdCompletion: jest.fn(),
    submitApplicationPackage: jest.fn(),
    submitReferralRequest: jest.fn(),
    saveReferralContactData: jest.fn(),
    lockApplicationPackage: jest.fn(),
    uploadMedicalAssessments: jest.fn(),
    submitDocumentsToICM: jest.fn(),
    activateNewApplication: jest.fn(),
  };

  const mockRequest = {} as Request;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSessionUtil.extractUserIdFromRequest.mockReturnValue(USER_ID);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ApplicationPackageController],
      providers: [
        { provide: ApplicationPackageService, useValue: mockService },
        { provide: SessionUtil, useValue: mockSessionUtil },
        {
          provide: PinoLogger,
          useValue: mockLogger,
        },
        { provide: AccessCodeService, useValue: mockAccessCodeService },
        { provide: UserService, useValue: mockUserService },
        { provide: SiebelApiService, useValue: mockSiebelApiService },
      ],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ApplicationPackageController>(
      ApplicationPackageController,
    );
  });

  describe('createApplicationPackage', () => {
    const dto = {
      subtype: ApplicationPackageSubType.FCH,
      subsubtype: ApplicationPackageSubSubType.FCH,
    };
    const mockPackage = { applicationPackageId: APPLICATION_PACKAGE_ID };

    it('calls service with dto and userId extracted from request', async () => {
      mockService.createApplicationPackage.mockResolvedValue(mockPackage);

      await controller.createApplicationPackage(dto, mockRequest);

      expect(mockService.createApplicationPackage).toHaveBeenCalledWith(
        dto,
        USER_ID,
      );
    });

    it('returns the created package', async () => {
      mockService.createApplicationPackage.mockResolvedValue(mockPackage);

      const result = await controller.createApplicationPackage(
        dto,
        mockRequest,
      );

      expect(result).toEqual(mockPackage);
    });

    it('rethrows errors from the service', async () => {
      mockService.createApplicationPackage.mockRejectedValue(
        new BadRequestException('Invalid data'),
      );

      await expect(
        controller.createApplicationPackage(dto, mockRequest),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateApplicationPackage', () => {
    const dto = { hasPartner: true };
    const mockPackage = { applicationPackageId: APPLICATION_PACKAGE_ID };

    it('calls service with packageId, dto, and userId', async () => {
      mockService.updateApplicationPackage.mockResolvedValue(mockPackage);

      await controller.updateApplicationPackage(
        APPLICATION_PACKAGE_ID,
        dto,
        mockRequest,
      );

      expect(mockService.updateApplicationPackage).toHaveBeenCalledWith(
        APPLICATION_PACKAGE_ID,
        dto,
        USER_ID,
      );
    });

    it('returns the updated package', async () => {
      mockService.updateApplicationPackage.mockResolvedValue(mockPackage);

      const result = await controller.updateApplicationPackage(
        APPLICATION_PACKAGE_ID,
        dto,
        mockRequest,
      );

      expect(result).toEqual(mockPackage);
    });

    it('rethrows errors from the service', async () => {
      mockService.updateApplicationPackage.mockRejectedValue(
        new NotFoundException('Package not found'),
      );

      await expect(
        controller.updateApplicationPackage(
          APPLICATION_PACKAGE_ID,
          dto,
          mockRequest,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getApplicationPackages', () => {
    const mockPackages = [{ applicationPackageId: APPLICATION_PACKAGE_ID }];

    it('calls service with userId extracted from request', async () => {
      mockService.getApplicationPackages.mockResolvedValue(mockPackages);

      await controller.getApplicationPackages(mockRequest);

      expect(mockService.getApplicationPackages).toHaveBeenCalledWith(USER_ID);
    });

    it('returns the list of packages', async () => {
      mockService.getApplicationPackages.mockResolvedValue(mockPackages);

      const result = await controller.getApplicationPackages(mockRequest);

      expect(result).toEqual(mockPackages);
    });

    it('rethrows errors from the service', async () => {
      mockService.getApplicationPackages.mockRejectedValue(
        new Error('DB error'),
      );

      await expect(
        controller.getApplicationPackages(mockRequest),
      ).rejects.toThrow('DB error');
    });
  });

  describe('getApplicationPackage', () => {
    const mockPackage = { applicationPackageId: APPLICATION_PACKAGE_ID };

    it('calls service with packageId and userId', async () => {
      mockService.getApplicationPackage.mockResolvedValue(mockPackage);

      await controller.getApplicationPackage(
        APPLICATION_PACKAGE_ID,
        mockRequest,
      );

      expect(mockService.getApplicationPackage).toHaveBeenCalledWith(
        APPLICATION_PACKAGE_ID,
        USER_ID,
      );
    });

    it('returns the package', async () => {
      mockService.getApplicationPackage.mockResolvedValue(mockPackage);

      const result = await controller.getApplicationPackage(
        APPLICATION_PACKAGE_ID,
        mockRequest,
      );

      expect(result).toEqual(mockPackage);
    });

    it('rethrows NotFoundException from the service', async () => {
      mockService.getApplicationPackage.mockRejectedValue(
        new NotFoundException('Not found'),
      );

      await expect(
        controller.getApplicationPackage(APPLICATION_PACKAGE_ID, mockRequest),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getApplicationForms', () => {
    const mockForms = [{ applicationFormId: 'form-001' }];

    it('calls service with packageId and userId', async () => {
      mockService.getApplicationFormsByPackageId.mockResolvedValue(mockForms);

      await controller.getApplicationForms(APPLICATION_PACKAGE_ID, mockRequest);

      expect(mockService.getApplicationFormsByPackageId).toHaveBeenCalledWith(
        APPLICATION_PACKAGE_ID,
        USER_ID,
      );
    });

    it('returns the forms', async () => {
      mockService.getApplicationFormsByPackageId.mockResolvedValue(mockForms);

      const result = await controller.getApplicationForms(
        APPLICATION_PACKAGE_ID,
        mockRequest,
      );

      expect(result).toEqual(mockForms);
    });
  });

  describe('cancelApplicationPackage', () => {
    it('calls service with correct cancel dto', async () => {
      mockService.cancelApplicationPackage.mockResolvedValue(undefined);

      await controller.cancelApplicationPackage(
        APPLICATION_PACKAGE_ID,
        mockRequest,
      );

      expect(mockService.cancelApplicationPackage).toHaveBeenCalledWith({
        userId: USER_ID,
        applicationPackageId: APPLICATION_PACKAGE_ID,
      });
    });

    it('returns void on success', async () => {
      mockService.cancelApplicationPackage.mockResolvedValue(undefined);

      const result = await controller.cancelApplicationPackage(
        APPLICATION_PACKAGE_ID,
        mockRequest,
      );

      expect(result).toBeUndefined();
    });
  });

  describe('validateHouseholdCompletion', () => {
    const mockValidation = { isComplete: true, errors: [] };

    it('calls service with packageId and userId', async () => {
      mockService.validateHouseholdCompletion.mockResolvedValue(mockValidation);

      await controller.validateHouseholdCompletion(
        APPLICATION_PACKAGE_ID,
        mockRequest,
      );

      expect(mockService.validateHouseholdCompletion).toHaveBeenCalledWith(
        APPLICATION_PACKAGE_ID,
        USER_ID,
      );
    });

    it('returns the validation result', async () => {
      mockService.validateHouseholdCompletion.mockResolvedValue(mockValidation);

      const result = await controller.validateHouseholdCompletion(
        APPLICATION_PACKAGE_ID,
        mockRequest,
      );

      expect(result).toEqual(mockValidation);
    });
  });

  describe('submitApplicationPackage', () => {
    const mockResult = { serviceRequestId: 'sr-001' };

    it('calls service with packageId and userId', async () => {
      mockService.submitApplicationPackage.mockResolvedValue(mockResult);

      await controller.submitApplicationPackage(
        APPLICATION_PACKAGE_ID,
        mockRequest,
      );

      expect(mockService.submitApplicationPackage).toHaveBeenCalledWith(
        APPLICATION_PACKAGE_ID,
        USER_ID,
      );
    });

    it('returns the service request id', async () => {
      mockService.submitApplicationPackage.mockResolvedValue(mockResult);

      const result = await controller.submitApplicationPackage(
        APPLICATION_PACKAGE_ID,
        mockRequest,
      );

      expect(result).toEqual(mockResult);
    });

    it('rethrows errors from the service', async () => {
      mockService.submitApplicationPackage.mockRejectedValue(
        new Error('Siebel error'),
      );

      await expect(
        controller.submitApplicationPackage(
          APPLICATION_PACKAGE_ID,
          mockRequest,
        ),
      ).rejects.toThrow('Siebel error');
    });
  });

  describe('submitReferralRequest', () => {
    const dto = { email: 'test@example.com' };
    const mockResult = { message: 'Referral requested' };

    it('calls service with packageId, userId, and dto', async () => {
      mockService.submitReferralRequest.mockResolvedValue(mockResult);

      await controller.submitReferralRequest(
        APPLICATION_PACKAGE_ID,
        dto,
        mockRequest,
      );

      expect(mockService.submitReferralRequest).toHaveBeenCalledWith(
        APPLICATION_PACKAGE_ID,
        USER_ID,
        dto,
      );
    });

    it('returns the result', async () => {
      mockService.submitReferralRequest.mockResolvedValue(mockResult);

      const result = await controller.submitReferralRequest(
        APPLICATION_PACKAGE_ID,
        dto,
        mockRequest,
      );

      expect(result).toEqual(mockResult);
    });

    it('rethrows errors from the service', async () => {
      mockService.submitReferralRequest.mockRejectedValue(
        new Error('Siebel error'),
      );

      await expect(
        controller.submitReferralRequest(
          APPLICATION_PACKAGE_ID,
          dto,
          mockRequest,
        ),
      ).rejects.toThrow('Siebel error');
    });
  });

  describe('saveReferralContactData', () => {
    const dto = { email: 'test@example.com' };
    const mockResult = { message: 'Saved' };

    it('calls service with packageId, userId, and dto', async () => {
      mockService.saveReferralContactData.mockResolvedValue(mockResult);

      await controller.saveReferralContactData(
        APPLICATION_PACKAGE_ID,
        dto,
        mockRequest,
      );

      expect(mockService.saveReferralContactData).toHaveBeenCalledWith(
        APPLICATION_PACKAGE_ID,
        USER_ID,
        dto,
      );
    });

    it('returns the result', async () => {
      mockService.saveReferralContactData.mockResolvedValue(mockResult);

      const result = await controller.saveReferralContactData(
        APPLICATION_PACKAGE_ID,
        dto,
        mockRequest,
      );

      expect(result).toEqual(mockResult);
    });
  });

  describe('validateAndProcessApplication (lock-application)', () => {
    it('calls lockApplicationPackage with packageId and userId', async () => {
      mockService.lockApplicationPackage.mockResolvedValue({
        status: ApplicationPackageStatus.CONSENT,
      });

      await controller.validateAndProcessApplication(
        APPLICATION_PACKAGE_ID,
        mockRequest,
      );

      expect(mockService.lockApplicationPackage).toHaveBeenCalledWith(
        APPLICATION_PACKAGE_ID,
        USER_ID,
      );
    });

    it('returns Consent status when screening is required', async () => {
      mockService.lockApplicationPackage.mockResolvedValue({
        status: ApplicationPackageStatus.CONSENT,
      });

      const result = await controller.validateAndProcessApplication(
        APPLICATION_PACKAGE_ID,
        mockRequest,
      );

      expect(result).toEqual({ status: ApplicationPackageStatus.CONSENT });
    });

    it('returns Submitted status when no screening required', async () => {
      mockService.lockApplicationPackage.mockResolvedValue({
        status: ApplicationPackageStatus.SUBMITTED,
      });

      const result = await controller.validateAndProcessApplication(
        APPLICATION_PACKAGE_ID,
        mockRequest,
      );

      expect(result).toEqual({ status: ApplicationPackageStatus.SUBMITTED });
    });

    it('rethrows BadRequestException when household is incomplete', async () => {
      mockService.lockApplicationPackage.mockRejectedValue(
        new BadRequestException('Household data is incomplete'),
      );

      await expect(
        controller.validateAndProcessApplication(
          APPLICATION_PACKAGE_ID,
          mockRequest,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rethrows NotFoundException when package is not found', async () => {
      mockService.lockApplicationPackage.mockRejectedValue(
        new NotFoundException('Package not found'),
      );

      await expect(
        controller.validateAndProcessApplication(
          APPLICATION_PACKAGE_ID,
          mockRequest,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('uploadMedicalAssessments', () => {
    const mockResult = { success: true, attachmentsUploaded: 2 };

    it('calls service with packageId and userId', async () => {
      mockService.uploadMedicalAssessments.mockResolvedValue(mockResult);

      await controller.uploadMedicalAssessments(
        APPLICATION_PACKAGE_ID,
        mockRequest,
      );

      expect(mockService.uploadMedicalAssessments).toHaveBeenCalledWith(
        APPLICATION_PACKAGE_ID,
        USER_ID,
      );
    });

    it('returns the upload result', async () => {
      mockService.uploadMedicalAssessments.mockResolvedValue(mockResult);

      const result = await controller.uploadMedicalAssessments(
        APPLICATION_PACKAGE_ID,
        mockRequest,
      );

      expect(result).toEqual(mockResult);
    });
  });

  describe('submitDocumentsToICM', () => {
    const mockResult = { success: true, attachmentsUploaded: 1 };

    it('calls service with packageId, householdMemberId, attachmentType, and userId', async () => {
      mockService.submitDocumentsToICM.mockResolvedValue(mockResult);

      await controller.submitDocumentsToICM(
        APPLICATION_PACKAGE_ID,
        { householdMemberId: 'hm-001', attachmentType: AttachmentType.CONSENT },
        mockRequest,
      );

      expect(mockService.submitDocumentsToICM).toHaveBeenCalledWith(
        APPLICATION_PACKAGE_ID,
        'hm-001',
        AttachmentType.CONSENT,
        USER_ID,
      );
    });

    it('passes null when householdMemberId is omitted', async () => {
      mockService.submitDocumentsToICM.mockResolvedValue(mockResult);

      await controller.submitDocumentsToICM(
        APPLICATION_PACKAGE_ID,
        { attachmentType: AttachmentType.CONSENT },
        mockRequest,
      );

      expect(mockService.submitDocumentsToICM).toHaveBeenCalledWith(
        APPLICATION_PACKAGE_ID,
        null,
        AttachmentType.CONSENT,
        USER_ID,
      );
    });

    it('casts attachmentType string to AttachmentType enum', async () => {
      mockService.submitDocumentsToICM.mockResolvedValue(mockResult);

      await controller.submitDocumentsToICM(
        APPLICATION_PACKAGE_ID,
        { attachmentType: 'Consent' },
        mockRequest,
      );

      expect(mockService.submitDocumentsToICM).toHaveBeenCalledWith(
        APPLICATION_PACKAGE_ID,
        null,
        'Consent',
        USER_ID,
      );
    });

    it('returns the upload result', async () => {
      mockService.submitDocumentsToICM.mockResolvedValue(mockResult);

      const result = await controller.submitDocumentsToICM(
        APPLICATION_PACKAGE_ID,
        { attachmentType: AttachmentType.CONSENT },
        mockRequest,
      );

      expect(result).toEqual(mockResult);
    });
  });

  describe('redeemAccessCode', () => {
    const dto = { accessCode: 'ABC123' };
    const mockUser = {
      last_name: 'Doe',
      dateOfBirth: '1990-01-15',
      bc_services_card_id: 'bcsc-did-999',
    };

    beforeEach(() => {
      mockUserService.findOne.mockResolvedValue(mockUser);
      mockService.activateNewApplication = jest.fn();
    });

    it('returns failure when the user is not found', async () => {
      mockUserService.findOne.mockResolvedValue(null);

      const result = await controller.redeemAccessCode(dto, mockRequest);

      expect(result).toEqual({ success: false, message: 'User not found' });
      expect(
        mockAccessCodeService.associateUserWithAccessCode,
      ).not.toHaveBeenCalled();
    });

    it('returns failure when redemption fails', async () => {
      mockAccessCodeService.associateUserWithAccessCode.mockResolvedValue({
        success: false,
        error: 'Invalid or expired access code',
      });

      const result = await controller.redeemAccessCode(dto, mockRequest);

      expect(result).toEqual({
        success: false,
        message: 'Invalid or expired access code',
      });
    });

    it('does not activate a new application for a SCREENING redemption', async () => {
      mockAccessCodeService.associateUserWithAccessCode.mockResolvedValue({
        success: true,
        householdMemberId: 'hm-001',
      });

      const result = await controller.redeemAccessCode(dto, mockRequest);

      expect(mockService.activateNewApplication).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('activates the new application for a NEW_APPLICATION redemption', async () => {
      mockAccessCodeService.associateUserWithAccessCode.mockResolvedValue({
        success: true,
        type: AccessCodeType.NEW_APPLICATION,
        applicationPackageId: 'pkg-001',
      });

      await controller.redeemAccessCode(dto, mockRequest);

      expect(mockService.activateNewApplication).toHaveBeenCalledWith(
        'pkg-001',
        USER_ID,
        'bcsc-did-999',
      );
    });

    it('still returns success if activateNewApplication throws', async () => {
      mockAccessCodeService.associateUserWithAccessCode.mockResolvedValue({
        success: true,
        type: AccessCodeType.NEW_APPLICATION,
        applicationPackageId: 'pkg-001',
      });
      mockService.activateNewApplication.mockRejectedValue(
        new Error('Siebel down'),
      );

      const result = await controller.redeemAccessCode(dto, mockRequest);

      expect(result.success).toBe(true);
    });
  });
});
