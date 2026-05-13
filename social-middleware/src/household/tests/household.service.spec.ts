import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { HouseholdService } from '../services/household.service';
import { HouseholdMembers } from '../schemas/household-members.schema';
import { ApplicationPackage } from '../../application-package/schema/application-package.schema';
import { MemberTypes } from '../enums/member-types.enum';
import { RelationshipToPrimary } from '../enums/relationship-to-primary.enum';
import { ApplicationPackageStatus } from '../../application-package/enums/application-package-status.enum';
import { CreateHouseholdMemberDto } from '../dto/create-household-member.dto';
import { Logger } from '@nestjs/common';

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
});

// Chainable mock helpers
const execChain = (value: any) => ({
  exec: jest.fn().mockResolvedValue(value),
});
const leanExecChain = (value: any) => ({
  lean: jest.fn().mockReturnValue(execChain(value)),
});
const leanChain = (value: any) => ({
  lean: jest.fn().mockResolvedValue(value),
});

function makeDto(
  overrides: Partial<CreateHouseholdMemberDto> = {},
): CreateHouseholdMemberDto {
  return {
    applicationPackageId: 'app-123',
    firstName: 'Jane',
    lastName: 'Doe',
    dateOfBirth: '2000-01-01',
    relationshipToPrimary: RelationshipToPrimary.Self,
    ...overrides,
  };
}

describe('HouseholdService', () => {
  let service: HouseholdService;
  let householdMemberModel: jest.Mocked<any>;
  let applicationPackageModel: jest.Mocked<any>;

  beforeEach(async () => {
    householdMemberModel = {
      findOneAndUpdate: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      findOneAndDelete: jest.fn(),
      deleteMany: jest.fn(),
    };
    applicationPackageModel = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HouseholdService,
        {
          provide: getModelToken(HouseholdMembers.name),
          useValue: householdMemberModel,
        },
        {
          provide: getModelToken(ApplicationPackage.name),
          useValue: applicationPackageModel,
        },
      ],
    }).compile();

    service = module.get<HouseholdService>(HouseholdService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createMember', () => {
    beforeEach(() => {
      // Default: no existing members (no duplicate)
      householdMemberModel.find.mockReturnValue(leanExecChain([]));
    });

    const stubUpsert = (memberType: MemberTypes) =>
      householdMemberModel.findOneAndUpdate.mockReturnValue(
        execChain({
          householdMemberId: 'generated-id',
          memberType,
          applicationPackageId: 'app-123',
        }),
      );

    it('assigns Primary memberType for Self relationship', async () => {
      stubUpsert(MemberTypes.Primary);
      await service.createMember(makeDto());
      expect(
        householdMemberModel.findOneAndUpdate.mock.calls[0][1].$set.memberType,
      ).toBe(MemberTypes.Primary);
    });

    it('assigns PrimaryNonApplicant memberType for Spouse', async () => {
      stubUpsert(MemberTypes.PrimaryNonApplicant);
      await service.createMember(
        makeDto({ relationshipToPrimary: RelationshipToPrimary.Spouse }),
      );
      expect(
        householdMemberModel.findOneAndUpdate.mock.calls[0][1].$set.memberType,
      ).toBe(MemberTypes.PrimaryNonApplicant);
    });

    it('assigns PrimaryNonApplicant memberType for Partner', async () => {
      stubUpsert(MemberTypes.PrimaryNonApplicant);
      await service.createMember(
        makeDto({ relationshipToPrimary: RelationshipToPrimary.Partner }),
      );
      expect(
        householdMemberModel.findOneAndUpdate.mock.calls[0][1].$set.memberType,
      ).toBe(MemberTypes.PrimaryNonApplicant);
    });

    it('assigns NonCaregiverAdult for adult (18+) with a non-partner relationship', async () => {
      stubUpsert(MemberTypes.NonCaregiverAdult);
      await service.createMember(
        makeDto({
          relationshipToPrimary: RelationshipToPrimary.Sibling,
          dateOfBirth: '2000-01-01',
        }),
      );

      expect(
        householdMemberModel.findOneAndUpdate.mock.calls[0][1].$set.memberType,
      ).toBe(MemberTypes.NonCaregiverAdult);
    });

    it('assigns NonAdult for a member under 18', async () => {
      stubUpsert(MemberTypes.NonAdult);
      await service.createMember(
        makeDto({
          relationshipToPrimary: RelationshipToPrimary.Child,
          dateOfBirth: '2020-01-01',
        }),
      );
      expect(
        householdMemberModel.findOneAndUpdate.mock.calls[0][1].$set.memberType,
      ).toBe(MemberTypes.NonAdult);
    });

    it('throws InternalServerErrorException when a duplicate member is detected', async () => {
      householdMemberModel.find.mockReturnValue(
        leanExecChain([
          {
            householdMemberId: 'other-id',
            firstName: 'Jane',
            lastName: 'Doe',
            dateOfBirth: '2000-01-01',
          },
        ]),
      );
      await expect(service.createMember(makeDto())).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('uses the provided householdMemberId in the upsert query', async () => {
      stubUpsert(MemberTypes.Primary);
      await service.createMember(makeDto({ householdMemberId: 'existing-id' }));
      expect(
        householdMemberModel.findOneAndUpdate.mock.calls[0][0]
          .householdMemberId,
      ).toBe('existing-id');
    });
  });

  describe('checkForDuplicate', () => {
    it('returns isDuplicate: false when no members exist', async () => {
      householdMemberModel.find.mockReturnValue(leanExecChain([]));
      const result = await service.checkForDuplicate(
        'app-123',
        'Jane',
        'Doe',
        '2000-01-01',
      );
      expect(result).toEqual({ isDuplicate: false });
    });

    it('returns isDuplicate: true when lastName, DOB, and first initial match', async () => {
      householdMemberModel.find.mockReturnValue(
        leanExecChain([
          {
            householdMemberId: 'other-id',
            firstName: 'John',
            lastName: 'Doe',
            dateOfBirth: '1990-05-15',
          },
        ]),
      );
      // 'James' shares first initial 'J' with 'John'
      const result = await service.checkForDuplicate(
        'app-123',
        'James',
        'doe',
        '1990-05-15',
      );
      expect(result.isDuplicate).toBe(true);
    });

    it('skips the excludeHouseholdMemberId record', async () => {
      householdMemberModel.find.mockReturnValue(
        leanExecChain([
          {
            householdMemberId: 'same-id',
            firstName: 'Jane',
            lastName: 'Doe',
            dateOfBirth: '2000-01-01',
          },
        ]),
      );
      const result = await service.checkForDuplicate(
        'app-123',
        'Jane',
        'Doe',
        '2000-01-01',
        'same-id',
      );
      expect(result.isDuplicate).toBe(false);
    });

    it('returns isDuplicate: false when last name differs', async () => {
      householdMemberModel.find.mockReturnValue(
        leanExecChain([
          {
            householdMemberId: 'other-id',
            firstName: 'Jane',
            lastName: 'Smith',
            dateOfBirth: '2000-01-01',
          },
        ]),
      );
      const result = await service.checkForDuplicate(
        'app-123',
        'Jane',
        'Doe',
        '2000-01-01',
      );
      expect(result.isDuplicate).toBe(false);
    });
  });

  describe('canResendAccessCode', () => {
    it('throws NotFoundException when the member does not exist', async () => {
      householdMemberModel.findOne.mockReturnValue(execChain(null));
      await expect(
        service.canResendAccessCode('nonexistent-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns canResend: false with reason "cooldown" when last sent less than 15 minutes ago', async () => {
      householdMemberModel.findOne.mockReturnValue(
        execChain({
          invitationLastSent: new Date(Date.now() - 5 * 60 * 1000),
          dailyResendCount: 0,
          dailyResendWindowStart: null,
        }),
      );
      const result = await service.canResendAccessCode('member-1');
      expect(result.canResend).toBe(false);
      expect(result.reason).toBe('cooldown');
      expect(result.cooldownMinutesRemaining).toBeGreaterThan(0);
    });

    it('returns canResend: false with reason "limit_reached" when daily limit of 3 is exhausted', async () => {
      householdMemberModel.findOne.mockReturnValue(
        execChain({
          invitationLastSent: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago, past cooldown
          dailyResendCount: 3,
          dailyResendWindowStart: new Date(Date.now() - 60 * 60 * 1000), // within 24h window
        }),
      );
      const result = await service.canResendAccessCode('member-1');
      expect(result.canResend).toBe(false);
      expect(result.reason).toBe('limit_reached');
      expect(result.resendsRemainingToday).toBe(0);
    });

    it('returns canResend: true with 3 remaining for a member with no prior sends', async () => {
      householdMemberModel.findOne.mockReturnValue(
        execChain({
          invitationLastSent: null,
          dailyResendCount: 0,
          dailyResendWindowStart: null,
        }),
      );
      const result = await service.canResendAccessCode('member-1');
      expect(result.canResend).toBe(true);
      expect(result.resendsRemainingToday).toBe(3);
    });
  });

  describe('validateHouseholdCompletion', () => {
    it('reports an error when a partner is required but none is found', async () => {
      householdMemberModel.find.mockReturnValue(leanChain([]));
      const result = await service.validateHouseholdCompletion(
        'app-123',
        'true',
        'false',
      );
      expect(result.isComplete).toBe(false);
      expect(result.errors).toContain(
        'Partner is required but no spouse/partner/common-law record found',
      );
    });

    it('reports an error when more than one partner record is found', async () => {
      householdMemberModel.find.mockReturnValue(
        leanChain([
          {
            relationshipToPrimary: RelationshipToPrimary.Spouse,
            firstName: 'A',
            lastName: 'B',
            dateOfBirth: '1990-01-01',
          },
          {
            relationshipToPrimary: RelationshipToPrimary.Partner,
            firstName: 'C',
            lastName: 'D',
            dateOfBirth: '1991-01-01',
          },
        ]),
      );
      const result = await service.validateHouseholdCompletion(
        'app-123',
        'true',
        'false',
      );
      expect(result.isComplete).toBe(false);
      expect(result.errors.some((e) => e.includes('Only 1 partner'))).toBe(
        true,
      );
    });

    it('reports an error when household members are required but none are found', async () => {
      householdMemberModel.find.mockReturnValue(leanChain([]));
      const result = await service.validateHouseholdCompletion(
        'app-123',
        'false',
        'true',
      );
      expect(result.isComplete).toBe(false);
      expect(result.errors).toContain(
        'Household members are required but none were found',
      );
    });
  });

  describe('verifyPackageEditable', () => {
    it('returns false when the package does not exist', async () => {
      applicationPackageModel.findOne.mockReturnValue(leanExecChain(null));
      expect(await service.verifyPackageEditable('app-123')).toBe(false);
    });

    it('returns true when package status is APPLICATION', async () => {
      applicationPackageModel.findOne.mockReturnValue(
        leanExecChain({ status: ApplicationPackageStatus.APPLICATION }),
      );
      expect(await service.verifyPackageEditable('app-123')).toBe(true);
    });

    it('returns true when package status is CONSENT', async () => {
      applicationPackageModel.findOne.mockReturnValue(
        leanExecChain({ status: ApplicationPackageStatus.CONSENT }),
      );
      expect(await service.verifyPackageEditable('app-123')).toBe(true);
    });

    it('returns false when package status is SUBMITTED', async () => {
      applicationPackageModel.findOne.mockReturnValue(
        leanExecChain({ status: ApplicationPackageStatus.SUBMITTED }),
      );
      expect(await service.verifyPackageEditable('app-123')).toBe(false);
    });
  });
});
