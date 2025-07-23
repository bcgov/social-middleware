import { Test, TestingModule } from '@nestjs/testing';
import { DevToolsService } from './dev-tools.service';

describe('DevToolsService', () => {
  let service: DevToolsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DevToolsService],
    }).compile();

    service = module.get<DevToolsService>(DevToolsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
