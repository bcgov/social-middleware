import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ServiceRequestStage } from '../application-package/enums/application-package-status.enum';
import { setConfigService } from '../common/config/config-loader';
import { DevToolsController } from './dev-tools.controller';
import { DevToolsService } from './dev-tools.service';
import { ClearUserDataQueryDto } from './dto/clear-user-data-query.dto';
import { ResetApplicationPackageQueryDto } from './dto/reset-application-package-query.dto';

describe('DevToolsController', () => {
  let controller: DevToolsController;
  let mockDevToolsService: {
    clearUserData: jest.Mock;
    resetApplicationPackage: jest.Mock;
    triggerStageTransition: jest.Mock;
  };

  const configFor = (nodeEnv: string | undefined) =>
    ({
      get: (key: string) => (key === 'NODE_ENV' ? nodeEnv : undefined),
    }) as unknown as ConfigService;

  beforeEach(async () => {
    mockDevToolsService = {
      clearUserData: jest.fn().mockResolvedValue({ success: true }),
      resetApplicationPackage: jest.fn().mockResolvedValue({ success: true }),
      triggerStageTransition: jest.fn().mockResolvedValue({ success: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DevToolsController],
      providers: [{ provide: DevToolsService, useValue: mockDevToolsService }],
    }).compile();

    controller = module.get<DevToolsController>(DevToolsController);
  });

  afterEach(() => {
    setConfigService(configFor('development'));
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('when NODE_ENV is not development/local', () => {
    beforeEach(() => {
      setConfigService(configFor('production'));
    });

    it('forbids clear-user-data', async () => {
      await expect(
        controller.clearUserData({ userId: 'user-1' }),
      ).rejects.toThrow(new ForbiddenException('Dev tools are disabled'));
      expect(mockDevToolsService.clearUserData).not.toHaveBeenCalled();
    });

    it('forbids reset-application-package', async () => {
      await expect(
        controller.resetApplicationPackage({
          applicationPackageId: 'pkg-1',
        }),
      ).rejects.toThrow(new ForbiddenException('Dev tools are disabled'));
      expect(
        mockDevToolsService.resetApplicationPackage,
      ).not.toHaveBeenCalled();
    });

    it('forbids trigger-stage', async () => {
      await expect(
        controller.triggerStage({
          applicationPackageId: 'pkg-1',
          stage: ServiceRequestStage.APPLICATION,
        }),
      ).rejects.toThrow(new ForbiddenException('Dev tools are disabled'));
      expect(mockDevToolsService.triggerStageTransition).not.toHaveBeenCalled();
    });

    it('forbids even when NODE_ENV is undefined', async () => {
      setConfigService(configFor(undefined));

      await expect(
        controller.clearUserData({ userId: 'user-1' }),
      ).rejects.toThrow(new ForbiddenException('Dev tools are disabled'));
    });
  });

  describe('when NODE_ENV is development', () => {
    beforeEach(() => {
      setConfigService(configFor('development'));
    });

    it('requires a userId for clear-user-data', async () => {
      await expect(
        controller.clearUserData({} as ClearUserDataQueryDto),
      ).rejects.toThrow(new BadRequestException('userId is required'));
      expect(mockDevToolsService.clearUserData).not.toHaveBeenCalled();
    });

    it('requires an applicationPackageId for reset-application-package', async () => {
      await expect(
        controller.resetApplicationPackage(
          {} as ResetApplicationPackageQueryDto,
        ),
      ).rejects.toThrow(
        new BadRequestException('applicationPackageId is required'),
      );
    });

    it('delegates clear-user-data to the service', async () => {
      const result = await controller.clearUserData({ userId: 'user-1' });

      expect(mockDevToolsService.clearUserData).toHaveBeenCalledWith('user-1');
      expect(result).toEqual({ success: true });
    });

    it('delegates reset-application-package to the service', async () => {
      const result = await controller.resetApplicationPackage({
        applicationPackageId: 'pkg-1',
      });

      expect(mockDevToolsService.resetApplicationPackage).toHaveBeenCalledWith(
        'pkg-1',
      );
      expect(result).toEqual({ success: true });
    });

    it('delegates trigger-stage to the service', async () => {
      const result = await controller.triggerStage({
        applicationPackageId: 'pkg-1',
        stage: ServiceRequestStage.APPLICATION,
      });

      expect(mockDevToolsService.triggerStageTransition).toHaveBeenCalledWith(
        'pkg-1',
        ServiceRequestStage.APPLICATION,
      );
      expect(result).toEqual({ success: true });
    });
  });
});
