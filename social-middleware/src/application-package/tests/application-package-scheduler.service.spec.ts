import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ApplicationPackageSchedulerService } from '../services/application-package-scheduler.service';
import { ApplicationPackageQueueService } from '../queue/application-package-queue.service';
import { CaregiverInvitationService } from '../services/caregiver-invitation.service';

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  setContext: jest.fn(),
};

describe('ApplicationPackageSchedulerService', () => {
  let service: ApplicationPackageSchedulerService;

  const mockQueueService = { scanAndEnqueuePackages: jest.fn() };
  const mockCaregiverInvitationService = { pollKinshipReferrals: jest.fn() };
  const mockConfigService = { get: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApplicationPackageSchedulerService,
        { provide: ApplicationPackageQueueService, useValue: mockQueueService },
        {
          provide: CaregiverInvitationService,
          useValue: mockCaregiverInvitationService,
        },
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: 'PinoLogger:ApplicationPackageSchedulerService',
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get<ApplicationPackageSchedulerService>(
      ApplicationPackageSchedulerService,
    );
  });

  describe('pollKinshipReferrals', () => {
    it('does not run when TEST_KINSHIP is "false"', async () => {
      mockConfigService.get.mockReturnValue('false');

      await service.pollKinshipReferrals();

      expect(
        mockCaregiverInvitationService.pollKinshipReferrals,
      ).not.toHaveBeenCalled();
    });

    it('runs when TEST_KINSHIP is unset', async () => {
      mockConfigService.get.mockReturnValue(undefined);

      await service.pollKinshipReferrals();

      expect(
        mockCaregiverInvitationService.pollKinshipReferrals,
      ).toHaveBeenCalled();
    });

    it('runs when TEST_KINSHIP is any value other than "false"', async () => {
      mockConfigService.get.mockReturnValue('true');

      await service.pollKinshipReferrals();

      expect(
        mockCaregiverInvitationService.pollKinshipReferrals,
      ).toHaveBeenCalled();
    });

    it('catches and logs errors from the invitation service without throwing', async () => {
      mockConfigService.get.mockReturnValue(undefined);
      mockCaregiverInvitationService.pollKinshipReferrals.mockRejectedValue(
        new Error('boom'),
      );

      await expect(service.pollKinshipReferrals()).resolves.toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('scanForPackages', () => {
    it('logs success details on completion', async () => {
      mockQueueService.scanAndEnqueuePackages.mockResolvedValue({
        completenessChecks: 2,
        submissions: 1,
      });

      await service.scanForPackages();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ completenessChecks: 2, submissions: 1 }),
        expect.stringContaining('completed successfully'),
      );
    });

    it('catches and logs errors without throwing', async () => {
      mockQueueService.scanAndEnqueuePackages.mockRejectedValue(
        new Error('queue error'),
      );

      await expect(service.scanForPackages()).resolves.toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});
