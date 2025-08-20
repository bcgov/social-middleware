import { Test, TestingModule } from '@nestjs/testing';
import { SiebelService } from './siebel.service';

describe('SiebelService', () => {
  let service: SiebelService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SiebelService],
    }).compile();

    service = module.get<SiebelService>(SiebelService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
