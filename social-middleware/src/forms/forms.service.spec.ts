import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { PinoLogger, getLoggerToken } from 'nestjs-pino';
import { FormsService } from './forms.service';
import { FormParameters } from 'src/application-form/schemas/form-parameters.schema';
import { ApplicationForm } from 'src/application-form/schemas/application-form.schema';
import { ApplicationFormService } from '../application-form/services/application-form.service';
import { UserService } from '../auth/user.service';

const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  setContext: jest.fn(),
};

describe('FormsService', () => {
  let service: FormsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FormsService,
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: getModelToken(FormParameters.name), useValue: {} },
        { provide: getModelToken(ApplicationForm.name), useValue: {} },
        {
          provide: getLoggerToken(ApplicationFormService.name),
          useValue: mockLogger,
        },
        { provide: UserService, useValue: {} },
        { provide: PinoLogger, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<FormsService>(FormsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
