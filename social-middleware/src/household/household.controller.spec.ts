import { Test, TestingModule } from '@nestjs/testing';
import { HouseholdController } from './household.controller';

describe('HouseholdController', () => {
  let controller: HouseholdController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HouseholdController],
    }).compile();

    controller = module.get<HouseholdController>(HouseholdController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
