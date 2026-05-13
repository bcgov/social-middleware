import { Test, TestingModule } from '@nestjs/testing';
import { DevToolsController } from './dev-tools.controller';
import { DevToolsService } from './dev-tools.service';

describe('DevToolsController', () => {
  let controller: DevToolsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DevToolsController],
      providers: [{ provide: DevToolsService, useValue: {} }],
    }).compile();

    controller = module.get<DevToolsController>(DevToolsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
