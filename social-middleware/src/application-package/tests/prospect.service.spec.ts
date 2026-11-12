import { PinoLogger } from 'nestjs-pino';
import { User } from '../../auth/schemas/user.schema';
import { UserUtil } from '../../common/utils/user.util';
import { GenderTypes } from '../../household/enums/gender-types.enum';
import { RelationshipToPrimary } from '../../household/enums/relationship-to-primary.enum';
import { HouseholdMembersDocument } from '../../household/schemas/household-members.schema';
import { HouseholdService } from '../../household/services/household.service';
import { SiebelApiService } from '../../siebel/siebel-api.service';
import { ProspectService } from '../services/prospect.service';

describe('ProspectService - buildHouseholdMemberPayload', () => {
  let service: ProspectService;

  const SR_ID = 'sr-1';

  const mockUserUtil = {
    firstAndMiddleName: jest.fn(),
    toTitleCase: jest.fn(),
    sexToGenderType: jest.fn(),
  };

  // local-time constructors, because formatDateForSiebel formats in local time
  const memberUser = {
    first_name: 'Sam Alexander',
    last_name: 'lee',
    bc_services_card_id: 'DID-123',
    dateOfBirth: new Date(1990, 4, 1),
    street_address: '1 Own St',
    city: 'Sidney',
    region: 'BC',
    postal_code: 'V8L 1A1',
    email: 'sam@example.com',
    home_phone: '250-111-1111',
    alternate_phone: '250-222-2222',
  } as unknown as User;

  const primary = {
    street_address: '123 Main St',
    city: 'Victoria',
    region: 'BC',
    postal_code: 'V8V 1A1',
    email: 'pat@example.com',
  } as unknown as User;
  const member = (overrides: Record<string, unknown> = {}) =>
    ({
      firstName: 'Sam Alexander',
      lastName: 'lee',
      dateOfBirth: new Date(1990, 4, 1),
      genderType: GenderTypes.ManBoy,
      relationshipToPrimary: RelationshipToPrimary.Sibling,
      email: 'sam@example.com',
      ...overrides,
    }) as unknown as HouseholdMembersDocument;
  beforeEach(() => {
    jest.resetAllMocks();
    mockUserUtil.firstAndMiddleName.mockImplementation((name: string) => {
      const [firstName, ...rest] = name.split(' ');
      return { firstName, middleName: rest.join(' ') };
    });
    mockUserUtil.toTitleCase.mockImplementation(
      (s: string) => s.charAt(0).toUpperCase() + s.slice(1),
    );
    service = new ProspectService(
      {} as SiebelApiService,
      {} as HouseholdService,
      mockUserUtil as unknown as UserUtil,
      { info: jest.fn(), error: jest.fn() } as unknown as PinoLogger,
    );
  });

  describe('for a member who signed in', () => {
    it("builds the payload from the member's own BC Services Card record", () => {
      const payload = service.buildHouseholdMemberPayload(
        member(),
        memberUser,
        primary,
        SR_ID,
      );

      expect(payload).toEqual({
        ServiceRequestId: SR_ID,
        IcmBcscDid: 'DID-123',
        FirstName: 'Sam',
        MiddleName: 'Alexander',
        LastName: 'Lee',
        DateofBirth: '05/01/1990',
        StreetAddress: '1 Own St',
        City: 'Sidney',
        Prov: 'BC',
        PostalCode: 'V8L 1A1',
        EmailAddress: 'sam@example.com',
        HomePhone: '250-111-1111',
        AlternatePhone: '250-222-2222',
        Gender: GenderTypes.ManBoy,
        Relationship: RelationshipToPrimary.Sibling,
        ApplicantFlag: 'N',
      });
    });

    it('sends empty phone numbers when the user has none', () => {
      const payload = service.buildHouseholdMemberPayload(
        member(),
        {
          ...memberUser,
          home_phone: undefined,
          alternate_phone: undefined,
        },
        primary,
        SR_ID,
      );

      expect(payload.HomePhone).toBe('');
      expect(payload.AlternatePhone).toBe('');
    });
  });

  describe('for a member with no user account', () => {
    it("builds the payload from the member record, with the primary applicant's address", () => {
      const payload = service.buildHouseholdMemberPayload(
        member(),
        null,
        primary,
        SR_ID,
      );

      expect(payload).toEqual({
        ServiceRequestId: SR_ID,
        IcmBcscDid: '',
        FirstName: 'Sam',
        MiddleName: 'Alexander',
        LastName: 'Lee',
        DateofBirth: '05/01/1990',
        StreetAddress: '123 Main St',
        City: 'Victoria',
        Prov: 'BC',
        PostalCode: 'V8V 1A1',
        EmailAddress: '',
        HomePhone: '',
        AlternatePhone: '',
        Gender: GenderTypes.ManBoy,
        Relationship: RelationshipToPrimary.Sibling,
        ApplicantFlag: 'N',
      });
    });
  });
  describe('either way', () => {
    it.each([
      [RelationshipToPrimary.Spouse, 'Y'],
      [RelationshipToPrimary.Partner, 'Y'],
      [RelationshipToPrimary.CommonLaw, 'Y'],
      [RelationshipToPrimary.Sibling, 'N'],
      [RelationshipToPrimary.Child, 'N'],
    ])('sets the applicant flag for %s to %s', (relationship, flag) => {
      const payload = service.buildHouseholdMemberPayload(
        member({ relationshipToPrimary: relationship }),
        null,
        primary,
        SR_ID,
      );

      expect(payload.Relationship).toBe(relationship);
      expect(payload.ApplicantFlag).toBe(flag);
    });

    it('falls back to Unspecified when the member has no gender', () => {
      const payload = service.buildHouseholdMemberPayload(
        member({ genderType: undefined }),
        null,
        primary,
        SR_ID,
      );

      expect(payload.Gender).toBe(GenderTypes.Unspecified);
    });
  });
});
