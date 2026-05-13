import { Test, TestingModule } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import { HouseholdController } from './household.controller';
import { HouseholdService } from './services/household.service';
import { AccessCodeService } from './services/access-code.service';
import { ApplicationFormService } from '../application-form/services/application-form.service';
import { NotificationService } from '../notifications/services/notification.service';
import { SessionUtil } from '../common/utils/session.util';
import { SessionAuthGuard } from '../auth/session-auth.guard';

describe('HouseholdController', () => {
  let controller: HouseholdController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HouseholdController],
      providers: [
        { provide: HouseholdService, useValue: {} },
        { provide: ApplicationFormService, useValue: {} },
        { provide: AccessCodeService, useValue: {} },
        { provide: NotificationService, useValue: {} },
        { provide: SessionUtil, useValue: {} },
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
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<HouseholdController>(HouseholdController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
