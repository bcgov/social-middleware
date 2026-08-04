import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { PinoLogger } from 'nestjs-pino';
import { DevToolsService } from './dev-tools.service';
import { User } from '../auth/schemas/user.schema';
import { ApplicationPackage } from '../application-package/schema/application-package.schema';
import { ApplicationForm } from '../application-form/schemas/application-form.schema';
import { FormParameters } from '../application-form/schemas/form-parameters.schema';
import { ScreeningAccessCode } from '../household/schemas/screening-access-code.schema';
import { HouseholdService } from '../household/services/household.service';
import { ApplicationPackageService } from '../application-package/services/application-package.service';

describe('DevToolsService', () => {
  let service: DevToolsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DevToolsService,
        { provide: getModelToken(User.name), useValue: {} },
        { provide: getModelToken(ApplicationPackage.name), useValue: {} },
        { provide: getModelToken(ApplicationForm.name), useValue: {} },
        { provide: getModelToken(FormParameters.name), useValue: {} },
        { provide: getModelToken(ScreeningAccessCode.name), useValue: {} },
        { provide: HouseholdService, useValue: {} },
        { provide: ApplicationPackageService, useValue: {} },
        {
          provide: PinoLogger,
          useValue: {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
            setContext: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<DevToolsService>(DevToolsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
