import { Test, TestingModule } from '@nestjs/testing';
import { DevToolsController } from './dev-tools.controller';

describe('DevToolsController', () => {
  let controller: DevToolsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DevToolsController],
    }).compile();

    controller = module.get<DevToolsController>(DevToolsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
