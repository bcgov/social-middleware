import {
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { ApplicationFormService } from '../../application-form/services/application-form.service';
import { AttachmentsService } from '../../attachments/attachments.service';
import { UserService } from '../../auth/user.service';
import { RelationshipToPrimary } from '../../household/enums/relationship-to-primary.enum';
import { HouseholdService } from '../../household/services/household.service';
import { ResourceCaseService } from '../../resource-case/resource-case.service';
import { SiebelApiService } from '../../siebel/siebel-api.service';
import { ApplicationPackageStatus } from '../enums/application-package-status.enum';
import { ApplicationPackageSubType } from '../enums/application-package-subtypes.enum';
import { ApplicationPackage } from '../schema/application-package.schema';
import {
  NonRetryableSubmissionError,
  ScreeningSrService,
} from '../services/screening-sr.service';
import { ProspectService } from '../services/prospect.service';
import { SrAttachmentService } from '../services/sr-attachment.service';

describe('ScreeningSrService', () => {
  let service: ScreeningSrService;

  const PACKAGE_ID = 'pkg-1';
  const OWNER_ID = 'owner-1';
  const SR_ID = 'sr-1';
  const CASE_ID = 'case-1';

  const ownerUser = { id: OWNER_ID, first_name: 'Pat', last_name: 'Primary' };
  const personUser = {
    id: 'person-1',
    first_name: 'Sam',
    last_name: 'Lee',
    bc_services_card_id: 'DID-123',
  };
  const selfMember = {
    householdMemberId: 'hm-self',
    relationshipToPrimary: RelationshipToPrimary.Self,
  };
  const personMember = {
    householdMemberId: 'hm-person',
    relationshipToPrimary: RelationshipToPrimary.Sibling,
    userId: 'person-1',
    prospectId: undefined as string | undefined,
  };
  const mockModel = { findOne: jest.fn(), updateOne: jest.fn() };
  const mockHousehold = {
    findAllHouseholdMembers: jest.fn(),
    updateHouseholdMember: jest.fn(),
  };
  const mockUsers = { findOne: jest.fn() };
  const mockResourceCase = { getOpenCaseForUser: jest.fn() };
  const mockSiebel = {
    createServiceRequest: jest.fn(),
    getServiceRequestCaseIds: jest.fn(),
    linkServiceRequestToCase: jest.fn(),
    createProspect: jest.fn(),
  };
  const mockConfig = { get: jest.fn() };
  const mockProspects = { buildHouseholdMemberPayload: jest.fn() };
  const mockForms = { findAllByApplicationPackageId: jest.fn() };
  const mockSrAttachments = { attachFormsToSr: jest.fn() };
  const mockAttachments = { findByHouseholdMemberId: jest.fn() };
  const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

  const packageDoc = (overrides: Record<string, unknown> = {}) => ({
    applicationPackageId: PACKAGE_ID,
    userId: OWNER_ID,
    subtype: ApplicationPackageSubType.ADDITIONAL_ADULT,
    ...overrides,
  });
  const givenPackage = (overrides: Record<string, unknown> = {}) =>
    mockModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(packageDoc(overrides)),
    });
  beforeEach(async () => {
    jest.resetAllMocks();
    givenPackage();
    mockModel.updateOne.mockResolvedValue({});
    mockHousehold.findAllHouseholdMembers.mockResolvedValue([
      selfMember,
      { ...personMember },
    ]);
    mockHousehold.updateHouseholdMember.mockResolvedValue({});
    mockUsers.findOne.mockImplementation((id: string) =>
      Promise.resolve(id === OWNER_ID ? ownerUser : personUser),
    );
    mockResourceCase.getOpenCaseForUser.mockResolvedValue({
      caseId: CASE_ID,
      officeName: 'Victoria Office',
      assignee: 'jsmith',
    });
    mockSiebel.createServiceRequest.mockResolvedValue({
      items: { Id: SR_ID },
    });
    mockSiebel.getServiceRequestCaseIds.mockResolvedValue([]);
    mockSiebel.linkServiceRequestToCase.mockResolvedValue({});
    mockSiebel.createProspect.mockResolvedValue({
      items: { Id: 'prospect-1' },
    });
    mockConfig.get.mockReturnValue('development');
    mockProspects.buildHouseholdMemberPayload.mockReturnValue({ payload: 1 });
    mockForms.findAllByApplicationPackageId.mockResolvedValue([
      { applicationFormId: 'f1', siebelAttachmentId: 'siebel-1' },
    ]);
    mockSrAttachments.attachFormsToSr.mockResolvedValue({
      attempted: 1,
      succeeded: 1,
    });
    mockAttachments.findByHouseholdMemberId.mockResolvedValue([]);
    const module = await Test.createTestingModule({
      providers: [
        ScreeningSrService,
        {
          provide: getModelToken(ApplicationPackage.name),
          useValue: mockModel,
        },
        { provide: HouseholdService, useValue: mockHousehold },
        { provide: UserService, useValue: mockUsers },
        { provide: ResourceCaseService, useValue: mockResourceCase },
        { provide: SiebelApiService, useValue: mockSiebel },
        { provide: ConfigService, useValue: mockConfig },
        { provide: ProspectService, useValue: mockProspects },
        { provide: ApplicationFormService, useValue: mockForms },
        { provide: SrAttachmentService, useValue: mockSrAttachments },
        { provide: AttachmentsService, useValue: mockAttachments },
        { provide: 'PinoLogger:ScreeningSrService', useValue: mockLogger },
      ],
    }).compile();
    service = module.get(ScreeningSrService);
  });
  describe('resolveSubject', () => {
    it('returns the non-Self member with their user', async () => {
      const subject = await service.resolveSubject(PACKAGE_ID, true);

      expect(subject.member.householdMemberId).toBe('hm-person');
      expect(subject.user).toBe(personUser);
    });
    it.each([
      ['no one being screened', [selfMember]],
      [
        'two people being screened',
        [selfMember, personMember, { ...personMember, householdMemberId: 'x' }],
      ],
    ])('rejects a package with %s', async (_label, members) => {
      mockHousehold.findAllHouseholdMembers.mockResolvedValue(members);

      await expect(service.resolveSubject(PACKAGE_ID, true)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
    it('requires redemption when sign-in is required', async () => {
      mockHousehold.findAllHouseholdMembers.mockResolvedValue([
        selfMember,
        { ...personMember, userId: undefined },
      ]);

      await expect(service.resolveSubject(PACKAGE_ID, true)).rejects.toThrow(
        'has not redeemed their access code',
      );
    });
    it('returns a null user when sign-in is not required and the person never signed in', async () => {
      mockHousehold.findAllHouseholdMembers.mockResolvedValue([
        selfMember,
        { ...personMember, userId: undefined },
      ]);

      const subject = await service.resolveSubject(PACKAGE_ID, false);

      expect(subject.user).toBeNull();
      expect(mockUsers.findOne).not.toHaveBeenCalled();
    });
    it('rejects a person whose account has no BC Services Card identity', async () => {
      mockUsers.findOne.mockResolvedValue({ id: 'person-1' });

      await expect(service.resolveSubject(PACKAGE_ID, false)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });
  });
  describe('ensureScreeningSr', () => {
    it('rejects an unknown package', async () => {
      mockModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.ensureScreeningSr(PACKAGE_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
    it('creates a Caregiver Screening SR for the person, saves it, and links the case', async () => {
      const result = await service.ensureScreeningSr(PACKAGE_ID);

      expect(mockSiebel.createServiceRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          Type: 'Caregiver Screening',
          'ICM BCSC DID': 'DID-123',
          'Service Office': 'Victoria Office',
        }),
        'jsmith',
      );
      expect(mockModel.updateOne).toHaveBeenCalledWith(
        { applicationPackageId: PACKAGE_ID },
        { srId: SR_ID },
      );
      expect(mockSiebel.linkServiceRequestToCase).toHaveBeenCalledWith(
        SR_ID,
        CASE_ID,
      );
      expect(result.srId).toBe(SR_ID);
      expect(result.ownerUserId).toBe(OWNER_ID);
    });

    it('names the environment in the SR memo outside production', async () => {
      mockConfig.get.mockReturnValue('development');

      await service.ensureScreeningSr(PACKAGE_ID);

      expect(mockSiebel.createServiceRequest).toHaveBeenCalledWith(
        expect.objectContaining({ Memo: 'Created By development Portal' }),
        'jsmith',
      );
    });

    it('leaves the environment out of the SR memo in production', async () => {
      mockConfig.get.mockReturnValue('production');

      await service.ensureScreeningSr(PACKAGE_ID);

      expect(mockSiebel.createServiceRequest).toHaveBeenCalledWith(
        expect.objectContaining({ Memo: 'Created By  Portal' }),
        'jsmith',
      );
    });
    it('saves the srId before linking, so a failed link never loses the SR', async () => {
      mockSiebel.linkServiceRequestToCase.mockRejectedValue(new Error('boom'));

      await expect(service.ensureScreeningSr(PACKAGE_ID)).rejects.toThrow(
        'boom',
      );

      expect(mockModel.updateOne).toHaveBeenCalledWith(
        { applicationPackageId: PACKAGE_ID },
        { srId: SR_ID },
      );
    });
    it('leaves the BCSC DID off the SR for an Additional Adult who never signed in', async () => {
      mockHousehold.findAllHouseholdMembers.mockResolvedValue([
        selfMember,
        { ...personMember, userId: undefined },
      ]);

      await service.ensureScreeningSr(PACKAGE_ID);

      const payload = mockSiebel.createServiceRequest.mock
        .calls[0][0] as Record<string, unknown>;
      expect(payload).not.toHaveProperty('ICM BCSC DID');
      expect(payload.Type).toBe('Caregiver Screening');
    });
    it('requires sign-in for a subtype that is not sign-in optional', async () => {
      givenPackage({ subtype: 'Relief Provider' });
      mockHousehold.findAllHouseholdMembers.mockResolvedValue([
        selfMember,
        { ...personMember, userId: undefined },
      ]);

      await expect(service.ensureScreeningSr(PACKAGE_ID)).rejects.toThrow(
        'has not redeemed their access code',
      );
      expect(mockSiebel.createServiceRequest).not.toHaveBeenCalled();
    });
    it('refuses a resource case with no local office, before creating anything', async () => {
      mockResourceCase.getOpenCaseForUser.mockResolvedValue({
        caseId: CASE_ID,
      });

      await expect(service.ensureScreeningSr(PACKAGE_ID)).rejects.toThrow(
        'The resource case has no local office',
      );
      expect(mockSiebel.createServiceRequest).not.toHaveBeenCalled();
    });
    it('fails when Siebel returns no SR id', async () => {
      mockSiebel.createServiceRequest.mockResolvedValue({ items: {} });

      await expect(service.ensureScreeningSr(PACKAGE_ID)).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(mockModel.updateOne).not.toHaveBeenCalled();
    });

    it('does not create a second SR on retry, and links the case if that is still missing', async () => {
      givenPackage({ srId: SR_ID });

      await service.ensureScreeningSr(PACKAGE_ID);

      expect(mockSiebel.createServiceRequest).not.toHaveBeenCalled();
      expect(mockSiebel.linkServiceRequestToCase).toHaveBeenCalledWith(
        SR_ID,
        CASE_ID,
      );
    });
    it('does not link the case again when it is already linked', async () => {
      givenPackage({ srId: SR_ID });
      mockSiebel.getServiceRequestCaseIds.mockResolvedValue([CASE_ID]);

      await service.ensureScreeningSr(PACKAGE_ID);

      expect(mockSiebel.linkServiceRequestToCase).not.toHaveBeenCalled();
    });
  });
  describe('submitScreening', () => {
    it('creates the prospect, attaches the forms and marks the package SUBMITTED', async () => {
      const result = await service.submitScreening(PACKAGE_ID);

      expect(mockProspects.buildHouseholdMemberPayload).toHaveBeenCalledWith(
        expect.objectContaining({ householdMemberId: 'hm-person' }),
        personUser,
        ownerUser,
        SR_ID,
      );
      expect(mockSiebel.createProspect).toHaveBeenCalledWith({ payload: 1 });
      expect(mockHousehold.updateHouseholdMember).toHaveBeenCalledWith(
        'hm-person',
        { prospectId: 'prospect-1' },
      );
      expect(mockSrAttachments.attachFormsToSr).toHaveBeenCalledWith(
        SR_ID,
        expect.any(Array),
        { applicationPackageId: PACKAGE_ID },
      );
      expect(mockModel.updateOne).toHaveBeenCalledWith(
        { applicationPackageId: PACKAGE_ID },
        expect.objectContaining({ status: ApplicationPackageStatus.SUBMITTED }),
      );
      expect(result).toEqual({ serviceRequestId: SR_ID });
    });
    it('builds the prospect from the member record when the person never signed in', async () => {
      mockHousehold.findAllHouseholdMembers.mockResolvedValue([
        selfMember,
        { ...personMember, userId: undefined },
      ]);

      await service.submitScreening(PACKAGE_ID);

      expect(mockProspects.buildHouseholdMemberPayload).toHaveBeenCalledWith(
        expect.anything(),
        null,
        ownerUser,
        SR_ID,
      );
    });
    it('does not create a second prospect on retry', async () => {
      mockHousehold.findAllHouseholdMembers.mockResolvedValue([
        selfMember,
        { ...personMember, prospectId: 'prospect-old' },
      ]);

      await service.submitScreening(PACKAGE_ID);

      expect(mockSiebel.createProspect).not.toHaveBeenCalled();
    });

    it('accepts a prospect id returned at the top level of the response', async () => {
      mockSiebel.createProspect.mockResolvedValue({ Id: 'prospect-top' });

      await service.submitScreening(PACKAGE_ID);

      expect(mockHousehold.updateHouseholdMember).toHaveBeenCalledWith(
        'hm-person',
        { prospectId: 'prospect-top' },
      );
    });
    it('fails when Siebel returns no prospect id, leaving the package unsubmitted', async () => {
      mockSiebel.createProspect.mockResolvedValue({});

      await expect(service.submitScreening(PACKAGE_ID)).rejects.toThrow(
        'Failed to get prospect ID from Siebel',
      );
      expect(mockSrAttachments.attachFormsToSr).not.toHaveBeenCalled();
    });
    describe('failure classification', () => {
      it('wraps a client-error HttpException as non-retryable', async () => {
        mockResourceCase.getOpenCaseForUser.mockRejectedValue(
          new NotFoundException('No open resource case'),
        );

        const error = await service
          .submitScreening(PACKAGE_ID)
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(NonRetryableSubmissionError);
        expect((error as Error).message).toBe('No open resource case');
      });
      it('treats a missing office as non-retryable', async () => {
        mockResourceCase.getOpenCaseForUser.mockResolvedValue({
          caseId: CASE_ID,
        });

        await expect(service.submitScreening(PACKAGE_ID)).rejects.toThrow(
          NonRetryableSubmissionError,
        );
      });

      it('leaves a server-error HttpException retryable', async () => {
        mockResourceCase.getOpenCaseForUser.mockRejectedValue(
          new HttpException('upstream down', 503),
        );

        const error = await service
          .submitScreening(PACKAGE_ID)
          .catch((e: unknown) => e);

        expect(error).not.toBeInstanceOf(NonRetryableSubmissionError);
      });
      it('leaves an ordinary error, such as a Siebel failure, retryable', async () => {
        mockSiebel.createServiceRequest.mockRejectedValue(
          new Error('Siebel API request failed'),
        );

        const error = await service
          .submitScreening(PACKAGE_ID)
          .catch((e: unknown) => e);

        expect(error).not.toBeInstanceOf(NonRetryableSubmissionError);
      });
    });
    describe('checking that everything is attached', () => {
      it('does not mark the package SUBMITTED while a form is still missing its attachment', async () => {
        mockForms.findAllByApplicationPackageId.mockResolvedValue([
          { applicationFormId: 'f1', siebelAttachmentId: 'siebel-1' },
          { applicationFormId: 'f2' },
        ]);

        const error = await service
          .submitScreening(PACKAGE_ID)
          .catch((e: unknown) => e);

        expect((error as Error).message).toContain('1 form(s)');
        expect(error).not.toBeInstanceOf(NonRetryableSubmissionError);
        expect(mockModel.updateOne).not.toHaveBeenCalledWith(
          { applicationPackageId: PACKAGE_ID },
          expect.objectContaining({
            status: ApplicationPackageStatus.SUBMITTED,
          }),
        );
      });

      it('accepts uploaded forms once every file is in ICM', async () => {
        mockForms.findAllByApplicationPackageId.mockResolvedValue([
          { applicationFormId: 'f1', userAttachedForm: true },
        ]);
        mockAttachments.findByHouseholdMemberId.mockResolvedValue([
          { attachmentId: 'a1', icmAttachmentId: 'icm-1' },
        ]);

        await expect(service.submitScreening(PACKAGE_ID)).resolves.toEqual({
          serviceRequestId: SR_ID,
        });
      });

      it('retries while an uploaded file is not in ICM yet', async () => {
        mockForms.findAllByApplicationPackageId.mockResolvedValue([
          { applicationFormId: 'f1', userAttachedForm: true },
        ]);
        mockAttachments.findByHouseholdMemberId.mockResolvedValue([
          { attachmentId: 'a1', icmAttachmentId: 'icm-1' },
          { attachmentId: 'a2' },
        ]);

        const error = await service
          .submitScreening(PACKAGE_ID)
          .catch((e: unknown) => e);

        expect((error as Error).message).toContain('1 upload(s)');
        expect(error).not.toBeInstanceOf(NonRetryableSubmissionError);
      });
      it('fails permanently when the forms were marked attached but nothing was uploaded', async () => {
        mockForms.findAllByApplicationPackageId.mockResolvedValue([
          { applicationFormId: 'f1', userAttachedForm: true },
        ]);
        mockAttachments.findByHouseholdMemberId.mockResolvedValue([]);

        await expect(service.submitScreening(PACKAGE_ID)).rejects.toThrow(
          NonRetryableSubmissionError,
        );
      });
    });
  });
});
