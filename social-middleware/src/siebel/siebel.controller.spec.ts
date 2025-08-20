import { Test, TestingModule } from '@nestjs/testing';
import { SiebelController } from './siebel.controller';

describe('SiebelController', () => {
  let controller: SiebelController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SiebelController],
    }).compile();

    controller = module.get<SiebelController>(SiebelController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
