import { Test, TestingModule } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import {
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { HouseholdController } from '../household.controller';
import { HouseholdService } from '../services/household.service';
import { AccessCodeService } from '../services/access-code.service';
import { ApplicationFormService } from '../../application-form/services/application-form.service';
import { NotificationService } from '../../notifications/services/notification.service';
import { SessionUtil } from '../../common/utils/session.util';
import { SessionAuthGuard } from '../../auth/session-auth.guard';
import { Request } from 'express';

describe('HouseholdController', () => {
  let controller: HouseholdController;

  const mockHouseholdService = {
    verifyUserOwnsPackage: jest.fn(),
    findById: jest.fn(),
    canResendAccessCode: jest.fn(),
    incrementResendTracking: jest.fn(),
    findPrimaryApplicant: jest.fn(),
  };

  const mockAccessCodeService = {
    resendOrCreateAccessCode: jest.fn(),
  };

  const mockNotificationService = {
    sendFCHAccessCode: jest.fn(),
  };

  const mockSessionUtil = {
    extractUserIdFromRequest: jest.fn(),
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

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HouseholdController],
      providers: [
        { provide: HouseholdService, useValue: mockHouseholdService },
        { provide: ApplicationFormService, useValue: {} },
        { provide: AccessCodeService, useValue: mockAccessCodeService },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: SessionUtil, useValue: mockSessionUtil },
        { provide: PinoLogger, useValue: mockLogger },
      ],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<HouseholdController>(HouseholdController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ─── resendAccessCode ────────────────────────────────────────────────────────

  describe('resendAccessCode', () => {
    const applicationPackageId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const householdMemberId = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
    const userId = 'user-001';

    const mockMember = {
      householdMemberId,
      applicationPackageId,
      firstName: 'Jerry',
      lastName: 'SERRANO',
      email: 'jerry@example.com',
      userId: null,
      screeningInfoProvided: false,
    };

    const mockResendResult = {
      accessCode: 'WBZRY2',
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      isNew: true,
    };

    const mockRequest = {} as Request;

    const setupHappyPath = () => {
      mockSessionUtil.extractUserIdFromRequest.mockReturnValue(userId);
      mockHouseholdService.verifyUserOwnsPackage.mockResolvedValue(true);
      mockHouseholdService.findById.mockResolvedValue(mockMember);
      mockHouseholdService.canResendAccessCode.mockResolvedValue({
        canResend: true,
        resendsRemainingToday: 3,
      });
      mockAccessCodeService.resendOrCreateAccessCode.mockResolvedValue(
        mockResendResult,
      );
      mockHouseholdService.incrementResendTracking.mockResolvedValue(undefined);
      mockHouseholdService.findPrimaryApplicant.mockResolvedValue({
        firstName: 'Primary',
        lastName: 'Applicant',
      });
      mockNotificationService.sendFCHAccessCode.mockResolvedValue(undefined);
    };

    it('throws UnauthorizedException when user does not own the package', async () => {
      setupHappyPath();
      mockHouseholdService.verifyUserOwnsPackage.mockResolvedValue(false);

      await expect(
        controller.resendAccessCode(
          applicationPackageId,
          householdMemberId,
          mockRequest,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws NotFoundException when household member is not found', async () => {
      setupHappyPath();
      mockHouseholdService.findById.mockResolvedValue(null);

      await expect(
        controller.resendAccessCode(
          applicationPackageId,
          householdMemberId,
          mockRequest,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when member has already logged in', async () => {
      setupHappyPath();
      mockHouseholdService.findById.mockResolvedValue({
        ...mockMember,
        userId: 'some-user-id',
      });

      await expect(
        controller.resendAccessCode(
          applicationPackageId,
          householdMemberId,
          mockRequest,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when screening info already provided', async () => {
      setupHappyPath();
      mockHouseholdService.findById.mockResolvedValue({
        ...mockMember,
        screeningInfoProvided: true,
      });

      await expect(
        controller.resendAccessCode(
          applicationPackageId,
          householdMemberId,
          mockRequest,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException with cooldown message when in cooldown', async () => {
      setupHappyPath();
      mockHouseholdService.canResendAccessCode.mockResolvedValue({
        canResend: false,
        reason: 'cooldown',
        cooldownMinutesRemaining: 15,
      });

      await expect(
        controller.resendAccessCode(
          applicationPackageId,
          householdMemberId,
          mockRequest,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when daily resend limit reached', async () => {
      setupHappyPath();
      mockHouseholdService.canResendAccessCode.mockResolvedValue({
        canResend: false,
        reason: 'daily_limit',
      });

      await expect(
        controller.resendAccessCode(
          applicationPackageId,
          householdMemberId,
          mockRequest,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('calls resendOrCreateAccessCode with householdMemberId first, applicationPackageId second', async () => {
      setupHappyPath();

      await controller.resendAccessCode(
        applicationPackageId,
        householdMemberId,
        mockRequest,
      );

      expect(
        mockAccessCodeService.resendOrCreateAccessCode,
      ).toHaveBeenCalledWith(householdMemberId, applicationPackageId);
    });

    it('does NOT call resendOrCreateAccessCode with swapped arguments', async () => {
      setupHappyPath();

      await controller.resendAccessCode(
        applicationPackageId,
        householdMemberId,
        mockRequest,
      );

      expect(
        mockAccessCodeService.resendOrCreateAccessCode,
      ).not.toHaveBeenCalledWith(applicationPackageId, householdMemberId);
    });

    it('sends notification email when member has an email and primary applicant exists', async () => {
      setupHappyPath();

      await controller.resendAccessCode(
        applicationPackageId,
        householdMemberId,
        mockRequest,
      );

      expect(mockNotificationService.sendFCHAccessCode).toHaveBeenCalledWith(
        'jerry@example.com',
        'Primary Applicant',
        'Jerry SERRANO',
        'WBZRY2',
      );
    });

    it('does not send notification when member has no email', async () => {
      setupHappyPath();
      mockHouseholdService.findById.mockResolvedValue({
        ...mockMember,
        email: null,
      });

      await controller.resendAccessCode(
        applicationPackageId,
        householdMemberId,
        mockRequest,
      );

      expect(mockNotificationService.sendFCHAccessCode).not.toHaveBeenCalled();
    });

    it('returns accessCode, expiresAt, isNew, and decremented resendsRemainingToday', async () => {
      setupHappyPath();

      const result = await controller.resendAccessCode(
        applicationPackageId,
        householdMemberId,
        mockRequest,
      );

      expect(result).toEqual({
        accessCode: 'WBZRY2',
        expiresAt: mockResendResult.expiresAt,
        isNew: true,
        resendsRemainingToday: 2,
      });
    });
  });
});
