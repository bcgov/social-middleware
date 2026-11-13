import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import { User } from '../../auth/schemas/user.schema';
import { UserService } from '../../auth/user.service';
import { SiebelApiService } from '../../siebel/siebel-api.service';
import { HouseholdContactService } from '../household-contact.service';
import { ResourceCaseService } from '../resource-case.service';
import { todayInPacific } from '../../common/utils/case-window.util';

describe('ResourceCaseService', () => {
  let service: ResourceCaseService;
  const userService = { findOne: jest.fn() };
  const contacts = {
    findOneForCase: jest.fn(),
    claimRemoval: jest.fn(),
    completeRemoval: jest.fn(),
    releaseRemoval: jest.fn(),
    listActiveForCase: jest.fn(),
  };
  const siebel = {
    getOpenResourceCasesByContactId: jest.fn(),
    createHouseholdRemovalNotification: jest.fn(),
  };
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const today = todayInPacific();
  const userBase = {
    id: 'u1',
    contact_id: 'icm-1',
    resource_case_id: 'case-1',
    resource_case_closed: false,
    resource_case_active_date: new Date('2000-01-01T00:00:00'),
  };

  const asUser = (o: Partial<User> = {}) =>
    ({ ...userBase, ...o }) as unknown as User;
  const icmCase = {
    Id: 'case-1',
    'Case Num': 'RC-1',
    'Assigned To Id': 'sw-1',
    'Assigned To': 'SWORKER',
  };

  const contact = {
    case_contact_id: 'cc-1',
    first_name: 'Sam',
    last_name: 'Lee',
    relationship: 'Parent',
    removal_requested: false,
    removal_departure_date: null,
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ResourceCaseService,
        { provide: UserService, useValue: userService },
        { provide: HouseholdContactService, useValue: contacts },
        { provide: SiebelApiService, useValue: siebel },
        { provide: PinoLogger, useValue: logger },
      ],
    }).compile();
    service = moduleRef.get(ResourceCaseService);

    userService.findOne.mockResolvedValue(asUser());
    contacts.findOneForCase.mockResolvedValue(contact);
    contacts.claimRemoval.mockResolvedValue(true);
    contacts.completeRemoval.mockResolvedValue(true);
    contacts.releaseRemoval.mockResolvedValue(undefined);
    siebel.getOpenResourceCasesByContactId.mockResolvedValue([icmCase]);
    siebel.createHouseholdRemovalNotification.mockResolvedValue({});
  });

  const remove = () =>
    service.requestHouseholdMemberRemoval('u1', 'cc-1', today);

  describe('requestHouseholdMemberRemoval', () => {
    it.each([
      ['no resource case', { resource_case_id: undefined }],
      ['closed case', { resource_case_closed: true }],
      ['no ICM contact id', { contact_id: undefined }],
    ])('403 and no side effects: %s', async (_n, override) => {
      userService.findOne.mockResolvedValue(asUser(override));
      await expect(remove()).rejects.toBeInstanceOf(ForbiddenException);
      expect(contacts.findOneForCase).not.toHaveBeenCalled();
      expect(siebel.getOpenResourceCasesByContactId).not.toHaveBeenCalled();
    });

    it('404 when the contact is not on the caller\u2019s case', async () => {
      contacts.findOneForCase.mockResolvedValue(null);
      await expect(remove()).rejects.toBeInstanceOf(NotFoundException);
      expect(contacts.findOneForCase).toHaveBeenCalledWith('case-1', 'cc-1');
      expect(contacts.claimRemoval).not.toHaveBeenCalled();
    });

    it.each([
      'Key player',
      'Spouse',
      'Partner',
      'Common law',
      'Relief Caregiver',
    ])(
      '403 when the contact is not manageable (%s), with no claim or ICM call',
      async (relationship) => {
        contacts.findOneForCase.mockResolvedValue({ ...contact, relationship });
        await expect(remove()).rejects.toBeInstanceOf(ForbiddenException);
        expect(contacts.claimRemoval).not.toHaveBeenCalled();
        expect(
          siebel.createHouseholdRemovalNotification,
        ).not.toHaveBeenCalled();
      },
    );

    it('is idempotent for a repeat with the same date', async () => {
      contacts.findOneForCase.mockResolvedValue({
        ...contact,
        removal_requested: true,
        removal_departure_date: today,
      });
      await expect(remove()).resolves.toBeUndefined();
      expect(contacts.claimRemoval).not.toHaveBeenCalled();
      expect(siebel.createHouseholdRemovalNotification).not.toHaveBeenCalled();
    });

    it('409 for a repeat with a different date', async () => {
      contacts.findOneForCase.mockResolvedValue({
        ...contact,
        removal_requested: true,
        removal_departure_date: '2000-02-02',
      });
      await expect(remove()).rejects.toBeInstanceOf(ConflictException);
    });

    it('400 for an invalid date, before claiming or calling ICM', async () => {
      await expect(
        service.requestHouseholdMemberRemoval('u1', 'cc-1', '1999-12-31'), // before case open
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(contacts.claimRemoval).not.toHaveBeenCalled();
      expect(siebel.getOpenResourceCasesByContactId).not.toHaveBeenCalled();
    });

    it('409 and no ICM call when another request holds the claim', async () => {
      contacts.claimRemoval.mockResolvedValue(false);
      await expect(remove()).rejects.toBeInstanceOf(ConflictException);
      expect(siebel.createHouseholdRemovalNotification).not.toHaveBeenCalled();
    });

    it('claims, notifies the assigned social worker, then completes', async () => {
      await remove();
      const claimId = contacts.claimRemoval.mock.calls[0][2] as string;
      expect(siebel.createHouseholdRemovalNotification).toHaveBeenCalledWith(
        'case-1',
        {
          owner: 'sw-1',
          assignedTo: 'SWORKER',
          caseNumber: 'RC-1',
          memberName: 'Sam Lee',
          departureDate: today,
        },
      );
      expect(contacts.completeRemoval).toHaveBeenCalledWith(
        'case-1',
        'cc-1',
        claimId,
        today,
      );
      expect(contacts.releaseRemoval).not.toHaveBeenCalled();
    });

    it('passes a stale-claim cutoff to claimRemoval', async () => {
      await remove();
      const staleBefore = contacts.claimRemoval.mock.calls[0][3] as Date;
      expect(Date.now() - staleBefore.getTime()).toBeGreaterThanOrEqual(
        2 * 60 * 1000 - 1000,
      );
    });

    it('502, releases the claim and does not complete when ICM fails', async () => {
      siebel.createHouseholdRemovalNotification.mockRejectedValue(
        new Error('boom'),
      );
      await expect(remove()).rejects.toBeInstanceOf(BadGatewayException);
      const claimId = contacts.claimRemoval.mock.calls[0][2] as string;
      expect(contacts.releaseRemoval).toHaveBeenCalledWith(
        'case-1',
        'cc-1',
        claimId,
      );
      expect(contacts.completeRemoval).not.toHaveBeenCalled();
    });

    it('403 and release when the case is not open in ICM', async () => {
      siebel.getOpenResourceCasesByContactId.mockResolvedValue([]);
      await expect(remove()).rejects.toBeInstanceOf(ForbiddenException);
      expect(contacts.releaseRemoval).toHaveBeenCalled();
      expect(siebel.createHouseholdRemovalNotification).not.toHaveBeenCalled();
    });
    it('422 and release when no social worker is assigned', async () => {
      siebel.getOpenResourceCasesByContactId.mockResolvedValue([
        { ...icmCase, 'Assigned To Id': '' },
      ]);
      await expect(remove()).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(contacts.releaseRemoval).toHaveBeenCalled();
    });

    it('still succeeds, with a warning, when the claim was lost before completion', async () => {
      contacts.completeRemoval.mockResolvedValue(false);
      await expect(remove()).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('does not mask the ICM error if releasing the claim also fails', async () => {
      siebel.createHouseholdRemovalNotification.mockRejectedValue(
        new Error('boom'),
      );
      contacts.releaseRemoval.mockRejectedValue(new Error('db down'));
      await expect(remove()).rejects.toBeInstanceOf(BadGatewayException);
    });
  });

  describe('getOpenCaseForUser', () => {
    it('returns the user with the case and assignee', async () => {
      const r = await service.getOpenCaseForUser('u1');
      expect(r).toMatchObject({
        caseId: 'case-1',
        caseNumber: 'RC-1',
        assigneeId: 'sw-1',
        assignee: 'SWORKER',
      });
      expect(r.user).toBeDefined();
    });
  });

  describe('listHouseholdContacts', () => {
    it('returns [] without a case or with a closed one', async () => {
      userService.findOne.mockResolvedValue(
        asUser({ resource_case_id: undefined }),
      );
      expect(await service.listHouseholdContacts('u1')).toEqual([]);
      userService.findOne.mockResolvedValue(
        asUser({ resource_case_closed: true }),
      );
      expect(await service.listHouseholdContacts('u1')).toEqual([]);
      expect(contacts.listActiveForCase).not.toHaveBeenCalled();
    });

    it('lists for the user\u2019s case with today\u2019s date', async () => {
      contacts.listActiveForCase.mockResolvedValue([
        { case_contact_id: 'cc-1' },
      ]);
      const r = await service.listHouseholdContacts('u1');
      expect(contacts.listActiveForCase).toHaveBeenCalledWith('case-1', today);
      expect(r).toEqual([{ case_contact_id: 'cc-1' }]);
    });
  });
});
