import { Test, TestingModule } from '@nestjs/testing';
import { FormsController } from './forms.controller';
import { FormsService } from './forms.service';

describe('FormsController', () => {
  let controller: FormsController;
  let mockFormsService: {
    validateTokenAndGetParameters: jest.Mock;
    validateTokenAndGetSavedJson: jest.Mock;
    getTombstoneDataByToken: jest.Mock;
  };

  beforeEach(async () => {
    mockFormsService = {
      validateTokenAndGetParameters: jest.fn(),
      validateTokenAndGetSavedJson: jest.fn(),
      getTombstoneDataByToken: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FormsController],
      providers: [{ provide: FormsService, useValue: mockFormsService }],
    }).compile();

    controller = module.get<FormsController>(FormsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates validateTokenAndGetParameters to the service', async () => {
    const dto = { token: 'tok-1' };

    await controller.validateTokenAndGetParameters(dto);

    expect(mockFormsService.validateTokenAndGetParameters).toHaveBeenCalledWith(
      dto,
    );
  });

  it('delegates validateTokenAndGetSavedJson to the service', async () => {
    const dto = { token: 'tok-1' };

    await controller.validateTokenAndGetSavedJson(dto);

    expect(mockFormsService.validateTokenAndGetSavedJson).toHaveBeenCalledWith(
      dto,
    );
  });

  it('delegates tombstone-data to the service', async () => {
    await controller.getTombstoneData({ formAccessToken: 'tok-1' });

    expect(mockFormsService.getTombstoneDataByToken).toHaveBeenCalledWith(
      'tok-1',
    );
  });
});
