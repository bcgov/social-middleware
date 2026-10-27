import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { User } from 'src/auth/schemas';
import { UserService } from '../../auth/user.service';
import {
  AuthEventsService,
  UserLoggedInEvent,
} from '../../common/events/auth-events.service';
import {
  SiebelApiService,
  SiebelCaseContact,
} from '../../siebel/siebel-api.service';
import { AuthListener } from '../listeners/auth.listener';
import { ApplicationPackageService } from '../services/application-package.service';
import { BcscSyncService } from '../services/bcsc-sync.service';
import { UserUtil } from '../../common/utils/user.util';
import { HouseholdContactService } from '../../resource-case/household-contact.service';

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
  bcscDataChanged: false,
};

const mockUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-001',
  bc_services_card_id: 'did-123',
  first_name: 'Jane',
  last_name: 'Doe',
  email: 'jane@example.com',
  dateOfBirth: '1990-01-01',
  street_address: '123 Main St',
  city: 'Victoria',
  country: 'Canada',
  region: 'BC',
  postal_code: 'V8V 1A1',
  contact_id: '',
  last_login: new Date(),
  status: 'active',
  bcsc_update_pending: false,
  resource_case_closed: false,
  ...overrides,
});

function makeListener(
  overrides: {
    userService?: Partial<
      jest.Mocked<Pick<UserService, 'findOne' | 'updateUser'>>
    >;
    siebelApiService?: Partial<
      jest.Mocked<
        Pick<
          SiebelApiService,
          'getContactByBcscId' | 'getServiceRequestsByBcscId'
        >
      >
    >;
    authEventsService?: Partial<
      jest.Mocked<
        Pick<
          AuthEventsService,
          'onUserLoggedIn' | 'completeUserSync' | 'emitUserLoggedInEvent'
        >
      >
    >;
    bcscSyncService?: Partial<
      jest.Mocked<Pick<BcscSyncService, 'syncOnLogin'>>
    >;
  } = {},
) {
  const userService = {
    findOne: jest.fn().mockResolvedValue(mockUser()),
    updateUser: jest.fn().mockResolvedValue(mockUser()),
    ...overrides.userService,
  };
  const siebelApiService = {
    getContactByBcscId: jest.fn().mockResolvedValue(null),
    getServiceRequestsByBcscId: jest.fn().mockResolvedValue({ items: [] }),
    ...overrides.siebelApiService,
  };
  const authEventsService = {
    onUserLoggedIn: jest.fn(),
    completeUserSync: jest.fn(),
    emitUserLoggedInEvent: jest.fn(),
    ...overrides.authEventsService,
  };
  const bcscSyncService = {
    syncOnLogin: jest.fn().mockResolvedValue(undefined),
    ...overrides.bcscSyncService,
  };

  return { userService, siebelApiService, authEventsService, bcscSyncService };
}

async function buildAndTrigger(
  mocks: ReturnType<typeof makeListener>,
  event: UserLoggedInEvent,
) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AuthListener,
      { provide: AuthEventsService, useValue: mocks.authEventsService },
      { provide: SiebelApiService, useValue: mocks.siebelApiService },
      {
        provide: ApplicationPackageService,
        useValue: {
          getApplicationPackages: jest.fn().mockResolvedValue([]),
          deleteWithdrawnPackages: jest.fn().mockResolvedValue(undefined),
        },
      },
      { provide: UserService, useValue: mocks.userService },
      { provide: BcscSyncService, useValue: mocks.bcscSyncService },
      { provide: ConfigService, useValue: { get: jest.fn() } },
      { provide: UserUtil, useValue: new UserUtil() },
      { provide: 'PinoLogger:AuthListener', useValue: mockLogger },
      {
        provide: HouseholdContactService,
        useValue: {
          syncFromIcm: jest.fn().mockResolvedValue(undefined),
          deleteAllForCase: jest.fn().mockResolvedValue(undefined),
        },
      },
    ],
  }).compile();

  const listener = module.get<AuthListener>(AuthListener);

  let loginCallback!: (e: UserLoggedInEvent) => void;
  mocks.authEventsService.onUserLoggedIn.mockImplementation((cb) => {
    loginCallback = cb;
  });
  listener.onModuleInit();

  const done = new Promise<void>((resolve) => {
    mocks.authEventsService.completeUserSync.mockImplementation(() =>
      resolve(),
    );
  });
  loginCallback(event);
  await done;
}

describe('AuthListener.syncContactId', () => {
  it('skips ICM lookup when contact_id is already set', async () => {
    const mocks = makeListener({
      userService: {
        findOne: jest
          .fn()
          .mockResolvedValue(mockUser({ contact_id: 'existing-id' })),
      },
    });

    await buildAndTrigger(mocks, mockUserEvent);

    expect(mocks.siebelApiService.getContactByBcscId).not.toHaveBeenCalled();
    expect(mocks.userService.updateUser).not.toHaveBeenCalled();
  });

  it('persists contact_id when ICM returns a match', async () => {
    const mocks = makeListener({
      userService: {
        findOne: jest.fn().mockResolvedValue(mockUser({ contact_id: '' })),
      },
      siebelApiService: {
        getContactByBcscId: jest.fn().mockResolvedValue({ Id: 'contact-abc' }),
      },
    });

    await buildAndTrigger(mocks, mockUserEvent);

    expect(mocks.userService.updateUser).toHaveBeenCalledWith('user-001', {
      contact_id: 'contact-abc',
    });
  });

  it('does not update user when ICM returns no match', async () => {
    const mocks = makeListener({
      userService: {
        findOne: jest.fn().mockResolvedValue(mockUser({ contact_id: '' })),
      },
      siebelApiService: {
        getContactByBcscId: jest.fn().mockResolvedValue(null),
      },
    });

    await buildAndTrigger(mocks, mockUserEvent);

    expect(mocks.userService.updateUser).not.toHaveBeenCalled();
  });

  it('logs error and does not block login when ICM call throws', async () => {
    const mocks = makeListener({
      userService: {
        findOne: jest.fn().mockResolvedValue(mockUser({ contact_id: '' })),
      },
      siebelApiService: {
        getContactByBcscId: jest
          .fn()
          .mockRejectedValue(new Error('Siebel unavailable')),
      },
    });

    await buildAndTrigger(mocks, mockUserEvent);

    expect(mocks.authEventsService.completeUserSync).toHaveBeenCalledWith(
      'user-001',
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-001' }),
      expect.stringContaining('login not blocked'),
    );
  });
});

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
        { provide: BcscSyncService, useValue: { syncOnLogin: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: UserUtil, useValue: new UserUtil() },
        {
          provide: HouseholdContactService,
          useValue: {
            syncFromIcm: jest.fn().mockResolvedValue(undefined),
            deleteAllForCase: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: 'PinoLogger:AuthListener', useValue: mockLogger },
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
    userService.findOne.mockResolvedValue(
      mockUser({ contact_id: 'existing-id' }),
    );

    await triggerLogin(mockUserEvent);

    expect(siebelApiService.getContactByBcscId).not.toHaveBeenCalled();
    expect(userService.updateUser).not.toHaveBeenCalled();
  });

  it('persists contact_id when ICM returns a match', async () => {
    userService.findOne.mockResolvedValue(mockUser({ contact_id: '' }));
    siebelApiService.getContactByBcscId.mockResolvedValue({
      Id: 'contact-abc',
    });

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
    userService.findOne.mockResolvedValue(mockUser({ contact_id: '' }));
    siebelApiService.getContactByBcscId.mockResolvedValue(null);

    await triggerLogin(mockUserEvent);

    expect(userService.updateUser).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-001' }),
      expect.stringContaining('No ICM contact found'),
    );
  });

  it('logs the error and does not block login when ICM call throws', async () => {
    userService.findOne.mockResolvedValue(mockUser({ contact_id: '' }));
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

// ─── BCSC sync (new tests) ──────────────────────────────────────────────────

describe('AuthListener — BCSC sync', () => {
  it('does not call syncOnLogin when bcscDataChanged is false', async () => {
    const mocks = makeListener();
    const event = { ...mockUserEvent, bcscDataChanged: false };

    await buildAndTrigger(mocks, event);

    expect(mocks.bcscSyncService.syncOnLogin).not.toHaveBeenCalled();
  });

  it('calls syncOnLogin with userId when bcscDataChanged is true', async () => {
    const mocks = makeListener();
    const event = { ...mockUserEvent, bcscDataChanged: true };

    await buildAndTrigger(mocks, event);

    expect(mocks.bcscSyncService.syncOnLogin).toHaveBeenCalledWith('user-001');
    expect(mocks.bcscSyncService.syncOnLogin).toHaveBeenCalledTimes(1);
  });

  it('calls syncOnLogin before the Siebel service request check', async () => {
    const callOrder: string[] = [];
    const mocks = makeListener({
      bcscSyncService: {
        syncOnLogin: jest.fn().mockImplementation(() => {
          callOrder.push('sync');
          return Promise.resolve();
        }),
      },
      siebelApiService: {
        getServiceRequestsByBcscId: jest.fn().mockImplementation(() => {
          callOrder.push('siebel');
          return Promise.resolve({ items: [] });
        }),
      },
    });
    const event = { ...mockUserEvent, bcscDataChanged: true };

    await buildAndTrigger(mocks, event);

    expect(callOrder).toEqual(['sync', 'siebel']);
  });

  it('completes the login event and logs the error when syncOnLogin throws', async () => {
    const mocks = makeListener({
      bcscSyncService: {
        syncOnLogin: jest.fn().mockRejectedValue(new Error('Sync failed')),
      },
    });
    const event = { ...mockUserEvent, bcscDataChanged: true };

    await buildAndTrigger(mocks, event);

    expect(mocks.authEventsService.completeUserSync).toHaveBeenCalledWith(
      'user-001',
    );
  });
});

// ─── Non-key player caregiver sync ───────────────────────────────────────────

describe('AuthListener.syncNonKeyPlayerCaregiver', () => {
  async function triggerLogin(
    user: User,
    caseContacts: SiebelCaseContact[] | Error,
    linkedUserIds: Map<string, string> = new Map(),
  ) {
    const userService = {
      findOne: jest.fn().mockResolvedValue(user),
      updateUser: jest.fn().mockResolvedValue(user),
      findIdsByContactIds: jest.fn().mockResolvedValue(linkedUserIds),
    };
    const siebelApiService = {
      getContactByBcscId: jest.fn().mockResolvedValue(null),
      getOpenResourceCasesByContactId: jest.fn().mockResolvedValue([]),
      getCaseContacts: jest.fn(),
      getServiceRequestsByBcscId: jest.fn().mockResolvedValue({ items: [] }),
    };
    if (caseContacts instanceof Error) {
      siebelApiService.getCaseContacts.mockRejectedValue(caseContacts);
    } else {
      siebelApiService.getCaseContacts.mockResolvedValue(caseContacts);
    }
    const authEventsService = {
      onUserLoggedIn: jest.fn(),
      completeUserSync: jest.fn(),
      emitUserLoggedInEvent: jest.fn(),
    };
    const householdContactService = {
      syncFromIcm: jest.fn().mockResolvedValue(undefined),
      deleteAllForCase: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthListener,
        { provide: AuthEventsService, useValue: authEventsService },
        { provide: SiebelApiService, useValue: siebelApiService },
        {
          provide: ApplicationPackageService,
          useValue: {
            getApplicationPackages: jest.fn().mockResolvedValue([]),
            deleteWithdrawnPackages: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: UserService, useValue: userService },
        { provide: UserUtil, useValue: new UserUtil() },
        { provide: BcscSyncService, useValue: { syncOnLogin: jest.fn() } },
        { provide: HouseholdContactService, useValue: householdContactService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'TEST_RESOURCE_CASE' ? 'true' : undefined,
            ),
          },
        },
        { provide: 'PinoLogger:AuthListener', useValue: mockLogger },
      ],
    }).compile();

    const listener = module.get<AuthListener>(AuthListener);

    let loginCallback!: (e: UserLoggedInEvent) => void;
    authEventsService.onUserLoggedIn.mockImplementation(
      (cb: (e: UserLoggedInEvent) => void) => {
        loginCallback = cb;
      },
    );
    listener.onModuleInit();

    const done = new Promise<void>((resolve) => {
      authEventsService.completeUserSync.mockImplementation(() => resolve());
    });
    loginCallback(mockUserEvent);
    await done;

    return {
      userService,
      siebelApiService,
      authEventsService,
      householdContactService,
    };
  }

  const activeCaseUser = (overrides: Partial<User> = {}): User =>
    mockUser({
      contact_id: 'contact-abc',
      resource_case_id: 'case-001',
      resource_case_closed: false,
      resource_case_last_checked: new Date(),
      ...overrides,
    });

  it('stores the matching active Spouse contact', async () => {
    const { userService } = await triggerLogin(activeCaseUser(), [
      {
        Id: '1',
        Relationship: 'Key player',
        'First Name': 'Jane',
        'Last Name': 'Doe',
        'End Date': '',
      },
      {
        Id: '2',
        Relationship: 'Spouse',
        'First Name': 'John',
        'Last Name': 'Smith',
        'End Date': '',
      },
    ]);

    expect(userService.updateUser).toHaveBeenCalledWith('user-001', {
      non_key_player_caregiver: {
        first_name: 'John',
        last_name: 'Smith',
        relationship: 'Spouse',
      },
    });
  });

  it('excludes contacts with an end date', async () => {
    const { userService } = await triggerLogin(activeCaseUser(), [
      {
        Id: '2',
        Relationship: 'Spouse',
        'First Name': 'John',
        'Last Name': 'Smith',
        'End Date': '01/15/2025',
      },
    ]);

    expect(userService.updateUser).toHaveBeenCalledWith('user-001', {
      non_key_player_caregiver: null,
    });
  });

  it('excludes contacts with non-caregiver relationships', async () => {
    const { userService } = await triggerLogin(activeCaseUser(), [
      {
        Id: '1',
        Relationship: 'Key player',
        'First Name': 'Molly',
        'Last Name': 'Moore',
        'End Date': '',
      },
      {
        Id: '2',
        Relationship: 'Unknown',
        'First Name': 'Bug',
        'Last Name': 'Caregiver',
        'End Date': '',
      },
    ]);

    expect(userService.updateUser).toHaveBeenCalledWith('user-001', {
      non_key_player_caregiver: null,
    });
  });

  it('warns and uses the first match when multiple non-key players exist', async () => {
    const { userService } = await triggerLogin(activeCaseUser(), [
      {
        Id: '1',
        Relationship: 'Spouse',
        'First Name': 'John',
        'Last Name': 'Smith',
        'End Date': '',
      },
      {
        Id: '2',
        Relationship: 'Common law',
        'First Name': 'Kim',
        'Last Name': 'Lee',
        'End Date': '',
      },
    ]);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-001', count: 2 }),
      expect.stringContaining('Multiple non-key player caregivers'),
    );
    expect(userService.updateUser).toHaveBeenCalledWith('user-001', {
      non_key_player_caregiver: {
        first_name: 'John',
        last_name: 'Smith',
        relationship: 'Spouse',
      },
    });
  });

  it('clears the stored caregiver when the user has no resource case', async () => {
    const user = mockUser({
      contact_id: 'contact-abc',
      resource_case_last_checked: new Date(),
      non_key_player_caregiver: {
        first_name: 'John',
        last_name: 'Smith',
        relationship: 'Spouse',
      },
    });
    const { userService, siebelApiService } = await triggerLogin(user, []);

    expect(siebelApiService.getCaseContacts).not.toHaveBeenCalled();
    expect(userService.updateUser).toHaveBeenCalledWith('user-001', {
      non_key_player_caregiver: null,
    });
  });

  it('clears the stored caregiver when the resource case is closed', async () => {
    const user = activeCaseUser({
      resource_case_closed: true,
      non_key_player_caregiver: {
        first_name: 'John',
        last_name: 'Smith',
        relationship: 'Spouse',
      },
    });
    const { userService } = await triggerLogin(user, []);

    expect(userService.updateUser).toHaveBeenCalledWith('user-001', {
      non_key_player_caregiver: null,
    });
  });

  it('does not write when there is no resource case and nothing stored', async () => {
    const user = mockUser({
      contact_id: 'contact-abc',
      resource_case_last_checked: new Date(),
    });
    const { userService } = await triggerLogin(user, []);

    expect(userService.updateUser).not.toHaveBeenCalled();
  });

  it('keeps the existing value and does not block login when the Siebel call fails', async () => {
    const { userService, authEventsService } = await triggerLogin(
      activeCaseUser(),
      new Error('Siebel unavailable'),
    );

    expect(userService.updateUser).not.toHaveBeenCalled();
    expect(authEventsService.completeUserSync).toHaveBeenCalledWith('user-001');
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-001' }),
      expect.stringContaining('login not blocked'),
    );
  });

  describe('household contacts sync', () => {
    const contact = (
      o: Partial<SiebelCaseContact> = {},
    ): SiebelCaseContact => ({
      Id: 'cc-1',
      'Person ID ICM': 'p-1',
      Relationship: 'Parent',
      'First Name': 'John',
      'Last Name': 'Smith',
      'End Date': '',
      Age: '40',
      ...o,
    });
    it('syncs adults for the case', async () => {
      const { householdContactService } = await triggerLogin(activeCaseUser(), [
        contact(),
      ]);

      expect(householdContactService.syncFromIcm).toHaveBeenCalledWith(
        'case-001',
        [
          {
            case_contact_id: 'cc-1',
            person_id: 'p-1',
            first_name: 'John',
            last_name: 'Smith',
            relationship: 'Parent',
            contact_end_date: null,
            linked_user_id: null,
          },
        ],
        expect.any(Date),
      );
    });

    it('skips relationships the portal does not store, and logs them', async () => {
      const { householdContactService } = await triggerLogin(activeCaseUser(), [
        contact({ Id: 'ok', Relationship: 'Boarder' }),
        contact({ Id: 'relief', Relationship: 'Relief Caregiver' }),
        contact({ Id: 'unknown', Relationship: 'Unknown' }),
        contact({ Id: 'none', Relationship: undefined }),
      ]);

      const synced = householdContactService.syncFromIcm.mock
        .calls[0][1] as Array<{ case_contact_id: string }>;
      expect(synced.map((c) => c.case_contact_id)).toEqual(['ok', 'relief']);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          relationships: expect.arrayContaining([
            'Unknown',
            '(none)',
          ]) as string[],
        }),
        expect.stringContaining('skipped'),
      );
      const logged = (
        mockLogger.debug.mock.calls as Array<[{ relationships: string[] }]>
      ).flatMap(([ctx]) => ctx.relationships);
      expect(logged).not.toContain('Relief Caregiver');
    });

    it('keeps caregiver rows and links them to registered users', async () => {
      const { householdContactService, userService } = await triggerLogin(
        activeCaseUser(),
        [
          contact({
            Id: 'kp',
            'Person ID ICM': 'p-kp',
            Relationship: 'Key player',
          }),
          contact({
            Id: 'sp',
            'Person ID ICM': 'p-sp',
            Relationship: 'Spouse',
          }),
          contact({
            Id: 'sp2',
            'Person ID ICM': 'p-sp2',
            Relationship: 'Partner',
          }),
          contact({ Id: 'ad', 'Person ID ICM': 'p-ad' }),
        ],
        new Map([
          ['p-kp', 'user-kp'],
          ['p-sp', 'user-sp'],
          ['p-ad', 'user-not-a-caregiver'], // must never be applied to a non-caregiver row
        ]),
      );

      expect(userService.findIdsByContactIds).toHaveBeenCalledWith([
        'p-kp',
        'p-sp',
        'p-sp2',
      ]);
      const synced = householdContactService.syncFromIcm.mock
        .calls[0][1] as Array<{
        case_contact_id: string;
        linked_user_id: string | null;
      }>;
      expect(
        Object.fromEntries(
          synced.map((c) => [c.case_contact_id, c.linked_user_id]),
        ),
      ).toEqual({ kp: 'user-kp', sp: 'user-sp', sp2: null, ad: null });
    });

    it('drops ended contacts, minors and rows missing an id or person id', async () => {
      const { householdContactService } = await triggerLogin(activeCaseUser(), [
        contact({ Id: 'ended', 'End Date': '01/15/2025' }),
        contact({ Id: 'future', 'End Date': '01/15/2099' }),
        contact({ Id: 'minor', Age: '12' }),
        contact({ Id: 'no-person', 'Person ID ICM': undefined }),
      ]);

      const synced = householdContactService.syncFromIcm.mock
        .calls[0][1] as Array<{ case_contact_id: string }>;
      expect(synced.map((c) => c.case_contact_id)).toEqual(['future']);
    });

    it('clears the case rows when the resource case is closed, without calling ICM', async () => {
      const { householdContactService, siebelApiService } = await triggerLogin(
        activeCaseUser({ resource_case_closed: true }),
        [],
      );
      expect(householdContactService.deleteAllForCase).toHaveBeenCalledWith(
        'case-001',
      );
      expect(householdContactService.syncFromIcm).not.toHaveBeenCalled();
      expect(siebelApiService.getCaseContacts).not.toHaveBeenCalled();
    });

    it('does nothing when the user has never had a resource case', async () => {
      const user = mockUser({
        contact_id: 'contact-abc',
        resource_case_last_checked: new Date(),
      });
      const { householdContactService, siebelApiService } = await triggerLogin(
        user,
        [],
      );
      expect(householdContactService.deleteAllForCase).not.toHaveBeenCalled();
      expect(householdContactService.syncFromIcm).not.toHaveBeenCalled();
      expect(siebelApiService.getCaseContacts).not.toHaveBeenCalled();
    });

    it('leaves stored contacts alone and does not block login when ICM fails', async () => {
      const { householdContactService, authEventsService } = await triggerLogin(
        activeCaseUser(),
        new Error('Siebel unavailable'),
      );
      expect(householdContactService.syncFromIcm).not.toHaveBeenCalled();
      expect(householdContactService.deleteAllForCase).not.toHaveBeenCalled();
      expect(authEventsService.completeUserSync).toHaveBeenCalledWith(
        'user-001',
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-001' }),
        expect.stringContaining('household contacts'),
      );
    });
  });
});
