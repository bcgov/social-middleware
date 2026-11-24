import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { User } from 'src/auth/schemas';
import { UserService } from 'src/auth/user.service';
import {
  AuthEventsService,
  UserLoggedInEvent,
} from 'src/common/events/auth-events.service';
import { UserUtil } from 'src/common/utils/user.util';
import { HouseholdContactService } from 'src/resource-case/household-contact.service';
import { IcmCaseSubType } from 'src/siebel/enums/icm-case-sub-type.enum';
import {
  DuplicateBcscContactError,
  SiebelApiService,
  SiebelResourceCase,
} from 'src/siebel/siebel-api.service';
import { AuthListener } from 'src/application-package/listeners/auth.listener';
import { ApplicationPackageService } from 'src/application-package/services/application-package.service';
import { BcscSyncService } from 'src/application-package/services/bcsc-sync.service';

const mockLogger = {
  setContext: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const loginEvent: UserLoggedInEvent = {
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
  contact_id: 'contact-abc',
  last_login: new Date(),
  status: 'active',
  bcsc_update_pending: false,
  resource_case_closed: false,
  ...overrides,
});

const icmCase = (o: Partial<SiebelResourceCase> = {}): SiebelResourceCase => ({
  Id: 'case-001',
  Status: 'Open',
  'Case Num': '1-001',
  'Assigned To': 'WORKER',
  'Created Date': '01/15/2025',
  'Reopened Date': '',
  'Case Sub Type': 'FCH',
  ...o,
});

async function login(options: {
  user: User;
  // cases returned for every contact id, or per contact id
  openCases?: SiebelResourceCase[] | Record<string, SiebelResourceCase[]>;
  duplicateContactIds?: string[];
}) {
  const { user, openCases = [], duplicateContactIds } = options;

  const userService = {
    findOne: jest.fn().mockResolvedValue(user),
    updateUser: jest.fn().mockResolvedValue(user),
    findIdsByContactIds: jest.fn().mockResolvedValue(new Map()),
  };
  const siebelApiService = {
    getContactByBcscId: duplicateContactIds
      ? jest
          .fn()
          .mockRejectedValue(
            new DuplicateBcscContactError('did-123', duplicateContactIds),
          )
      : jest.fn().mockResolvedValue(null),
    getOpenResourceCasesByContactId: jest.fn((id: string) =>
      Promise.resolve(
        Array.isArray(openCases) ? openCases : (openCases[id] ?? []),
      ),
    ),
    getCaseContacts: jest.fn().mockResolvedValue([]),
    getServiceRequestsByBcscId: jest.fn().mockResolvedValue({ items: [] }),
  };
  const authEventsService = {
    onUserLoggedIn: jest.fn(),
    completeUserSync: jest.fn(),
    emitUserLoggedInEvent: jest.fn(),
  };
  const config: Record<string, string> = {
    TEST_RESOURCE_CASE: 'true',
    ICM_DUPLICATE_DID_TIEBREAK: 'true',
  };

  const module = await Test.createTestingModule({
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
      { provide: BcscSyncService, useValue: { syncOnLogin: jest.fn() } },
      { provide: UserUtil, useValue: new UserUtil() },
      {
        provide: HouseholdContactService,
        useValue: {
          syncFromIcm: jest.fn().mockResolvedValue(undefined),
          deleteAllForCase: jest.fn().mockResolvedValue(undefined),
        },
      },
      {
        provide: ConfigService,
        useValue: { get: jest.fn((key: string) => config[key]) },
      },
      { provide: 'PinoLogger:AuthListener', useValue: mockLogger },
    ],
  }).compile();
  const listener = module.get(AuthListener);
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
  loginCallback(loginEvent);
  await done;

  // the resource case sync is the only write that stamps resource_case_last_checked
  const resourceCaseUpdate = userService.updateUser.mock.calls.find(
    ([, fields]) => 'resource_case_last_checked' in (fields as object),
  )?.[1] as Partial<User> | undefined;

  return { userService, siebelApiService, resourceCaseUpdate };
}
beforeEach(() => jest.clearAllMocks());

describe('AuthListener.syncResourceCase — case sub type', () => {
  it('stores the sub type of the open case', async () => {
    const { resourceCaseUpdate } = await login({
      user: mockUser(),
      openCases: [icmCase({ 'Case Sub Type': 'FCH/Out of Care' })],
    });

    expect(resourceCaseUpdate).toMatchObject({
      resource_case_id: 'case-001',
      resource_case_closed: false,
      resource_case_sub_type: IcmCaseSubType.FCH_OUT_OF_CARE,
    });
  });
  it('accepts ICM values that differ only in case or surrounding spaces', async () => {
    const { resourceCaseUpdate } = await login({
      user: mockUser(),
      openCases: [icmCase({ 'Case Sub Type': ' out of care ' })],
    });

    expect(resourceCaseUpdate?.resource_case_sub_type).toBe(
      IcmCaseSubType.OUT_OF_CARE,
    );
  });
  it('ignores open cases with a missing or unsupported sub type, even when newer', async () => {
    const { resourceCaseUpdate } = await login({
      user: mockUser(),
      openCases: [
        icmCase({
          Id: 'kinship',
          'Case Sub Type': 'Kinship',
          'Created Date': '06/01/2025',
        }),
        icmCase({
          Id: 'blank',
          'Case Sub Type': undefined,
          'Created Date': '06/01/2025',
        }),
        icmCase({ Id: 'fch', 'Case Sub Type': 'FCH' }),
      ],
    });
    expect(resourceCaseUpdate).toMatchObject({
      resource_case_id: 'fch',
      resource_case_sub_type: IcmCaseSubType.FCH,
    });
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-001', ignored: 2 }),
      expect.stringContaining('unsupported Case Sub Type'),
    );
  });
  it('uses the sub type of the most recently active case', async () => {
    const { resourceCaseUpdate } = await login({
      user: mockUser(),
      openCases: [
        icmCase({ Id: 'older', 'Created Date': '03/01/2025' }),
        icmCase({
          Id: 'reopened',
          'Case Sub Type': 'Out of Care',
          'Created Date': '01/01/2024',
          'Reopened Date': '06/01/2025',
        }),
      ],
    });
    expect(resourceCaseUpdate).toMatchObject({
      resource_case_id: 'reopened',
      resource_case_sub_type: IcmCaseSubType.OUT_OF_CARE,
    });
  });
  it('records no case when the only open case has an unsupported sub type', async () => {
    const { resourceCaseUpdate } = await login({
      user: mockUser(),
      openCases: [icmCase({ 'Case Sub Type': 'Kinship' })],
    });

    expect(resourceCaseUpdate).toEqual({
      resource_case_last_checked: expect.any(Date) as Date,
    });
  });
  it('closes a previously synced case and clears its sub type', async () => {
    const { resourceCaseUpdate } = await login({
      user: mockUser({
        resource_case_id: 'case-001',
        resource_case_sub_type: IcmCaseSubType.FCH,
      }),
      openCases: [],
    });

    expect(resourceCaseUpdate).toEqual({
      resource_case_last_checked: expect.any(Date) as Date,
      resource_case_closed: true,
      resource_case_sub_type: null,
    });
  });
  it('closes a previously synced case when ICM now reports only an unsupported sub type', async () => {
    const { resourceCaseUpdate } = await login({
      user: mockUser({
        resource_case_id: 'case-001',
        resource_case_sub_type: IcmCaseSubType.FCH,
      }),
      openCases: [icmCase({ 'Case Sub Type': 'Kinship' })],
    });

    expect(resourceCaseUpdate).toMatchObject({
      resource_case_closed: true,
      resource_case_sub_type: null,
    });
  });
  it('does not call ICM when the case was already checked today', async () => {
    const { siebelApiService, resourceCaseUpdate } = await login({
      user: mockUser({ resource_case_last_checked: new Date() }),
      openCases: [icmCase()],
    });

    expect(
      siebelApiService.getOpenResourceCasesByContactId,
    ).not.toHaveBeenCalled();
    expect(resourceCaseUpdate).toBeUndefined();
  });
});

describe('AuthListener — duplicate BCSC DID tie-break', () => {
  it('picks the contact whose open case has a supported sub type', async () => {
    const { userService } = await login({
      user: mockUser({ contact_id: '' }),
      duplicateContactIds: ['c-2', 'c-1'],
      openCases: {
        'c-1': [icmCase({ 'Case Sub Type': 'Kinship' })],
        'c-2': [icmCase({ 'Case Sub Type': 'FCH' })],
      },
    });
    expect(userService.updateUser).toHaveBeenCalledWith('user-001', {
      contact_id: 'c-2',
    });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ chosen: 'c-2', reason: 'open-resource-case' }),
      expect.stringContaining('tie-break'),
    );
  });

  it('falls back to the first contact id when no open case has a supported sub type', async () => {
    const { userService } = await login({
      user: mockUser({ contact_id: '' }),
      duplicateContactIds: ['c-2', 'c-1'],
      openCases: {
        'c-1': [],
        'c-2': [icmCase({ 'Case Sub Type': 'Kinship' })],
      },
    });

    expect(userService.updateUser).toHaveBeenCalledWith('user-001', {
      contact_id: 'c-1',
    });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ chosen: 'c-1', reason: 'fallback-first' }),
      expect.stringContaining('tie-break'),
    );
  });
});
