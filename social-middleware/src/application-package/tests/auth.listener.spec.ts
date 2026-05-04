import { Test, TestingModule } from '@nestjs/testing';
import { AuthListener } from '../listeners/auth.listener';
import {
  AuthEventsService,
  UserLoggedInEvent,
} from '../../common/events/auth-events.service';
import { SiebelApiService } from '../../siebel/siebel-api.service';
import { ApplicationPackageService } from '../application-package.service';
import { UserService } from '../../auth/user.service';
import { PinoLogger } from 'nestjs-pino';

const mockLogger = {
  setContext: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const mockUserEvent: UserLoggedInEvent = {
  userId: 'user-001',
  bc_services_card_id: 'did-123',
  timestamp: new Date(),
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
};

describe('AuthListener.syncContactId', () => {
  let listener: AuthListener;
  let userService: jest.Mocked<Pick<UserService, 'findOne' | 'updateUser'>>;
  let siebelApiService: jest.Mocked<
    Pick<SiebelApiService, 'getContactByBcscId' | 'getServiceRequestsByBcscId'>
  >;
  let authEventsService: jest.Mocked<
    Pick<
      AuthEventsService,
      'onUserLoggedIn' | 'completeUserSync' | 'emitUserLoggedInEvent'
    >
  >;

  beforeEach(async () => {
    userService = {
      findOne: jest.fn(),
      updateUser: jest.fn(),
    };

    siebelApiService = {
      getContactByBcscId: jest.fn(),
      getServiceRequestsByBcscId: jest.fn().mockResolvedValue({ items: [] }),
    };

    authEventsService = {
      onUserLoggedIn: jest.fn(),
      completeUserSync: jest.fn(),
      emitUserLoggedInEvent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthListener,
        { provide: AuthEventsService, useValue: authEventsService },
        { provide: SiebelApiService, useValue: siebelApiService },
        {
          provide: ApplicationPackageService,
          useValue: { getApplicationPackages: jest.fn().mockResolvedValue([]) },
        },
        { provide: UserService, useValue: userService },
        { provide: PinoLogger, useValue: mockLogger },
      ],
    }).compile();

    listener = module.get<AuthListener>(AuthListener);
    jest.clearAllMocks();
    siebelApiService.getServiceRequestsByBcscId.mockResolvedValue({
      items: [],
    });
    authEventsService.onUserLoggedIn.mockImplementation(() => {});
  });

  // Invoke syncContactId via handleUserLogin by triggering the registered callback
  async function triggerLogin(event: UserLoggedInEvent) {
    let loginCallback!: (e: UserLoggedInEvent) => void;
    authEventsService.onUserLoggedIn.mockImplementation((cb) => {
      loginCallback = cb;
    });
    listener.onModuleInit();
    const promise = new Promise<void>((resolve) => {
      authEventsService.completeUserSync.mockImplementation(() => resolve());
    });
    loginCallback(event);
    await promise;
  }

  it('skips ICM lookup when contact_id is already set', async () => {
    userService.findOne.mockResolvedValue({ contact_id: 'existing-id' } as any);

    await triggerLogin(mockUserEvent);

    expect(siebelApiService.getContactByBcscId).not.toHaveBeenCalled();
    expect(userService.updateUser).not.toHaveBeenCalled();
  });

  it('persists contact_id when ICM returns a match', async () => {
    userService.findOne.mockResolvedValue({ contact_id: undefined } as any);
    siebelApiService.getContactByBcscId.mockResolvedValue({
      items: [{ Id: 'contact-abc', 'ICM BCSC DID': 'did-123' }],
    } as any);

    await triggerLogin(mockUserEvent);

    expect(userService.updateUser).toHaveBeenCalledWith('user-001', {
      contact_id: 'contact-abc',
    });
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-001', contactId: 'contact-abc' }),
      expect.stringContaining('persisted'),
    );
  });

  it('does not update user when ICM returns no match', async () => {
    userService.findOne.mockResolvedValue({ contact_id: undefined } as any);
    siebelApiService.getContactByBcscId.mockResolvedValue(null);

    await triggerLogin(mockUserEvent);

    expect(userService.updateUser).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-001' }),
      expect.stringContaining('No ICM contact found'),
    );
  });

  it('logs the error and does not block login when ICM call throws', async () => {
    userService.findOne.mockResolvedValue({ contact_id: undefined } as any);
    siebelApiService.getContactByBcscId.mockRejectedValue(
      new Error('Siebel unavailable'),
    );

    await triggerLogin(mockUserEvent);

    expect(authEventsService.completeUserSync).toHaveBeenCalledWith('user-001');
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-001' }),
      expect.stringContaining('login not blocked'),
    );
    expect(userService.updateUser).not.toHaveBeenCalled();
  });
});
