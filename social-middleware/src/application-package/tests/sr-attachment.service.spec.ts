import { Test } from '@nestjs/testing';
import {
  ApplicationFormType,
  getFormIdForFormType,
} from '../../application-form/enums/application-form-types.enum';
import { ApplicationForm } from '../../application-form/schemas/application-form.schema';
import { ApplicationFormService } from '../../application-form/services/application-form.service';
import { AttachmentsService } from '../../attachments/attachments.service';
import { UserService } from '../../auth/user.service';
import { UserUtil } from '../../common/utils/user.util';
import { SiebelApiService } from '../../siebel/siebel-api.service';
import { SrAttachmentService } from '../services/sr-attachment.service';

describe('SrAttachmentService', () => {
  let service: SrAttachmentService;

  const SR_ID = 'sr-1';
  const CONTEXT = { applicationPackageId: 'pkg-1' };

  const mockForms = {
    claimFormForAttachment: jest.fn(),
    releaseAttachmentClaim: jest.fn(),
    convertFormDataToXml: jest.fn(),
    saveSiebelAttachmentId: jest.fn(),
  };
  const mockSiebel = {
    createFormAttachment: jest.fn(),
    createAttachment: jest.fn(),
  };
  const mockUsers = { findOne: jest.fn() };
  const mockUserUtil = {
    firstAndMiddleName: jest.fn(),
    toTitleCase: jest.fn(),
  };
  const mockAttachments = {
    findByHouseholdMemberId: jest.fn(),
    findById: jest.fn(),
    saveIcmAttachmentId: jest.fn(),
  };
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  const form = (overrides: Record<string, unknown> = {}): ApplicationForm =>
    ({
      applicationFormId: 'form-1',
      householdMemberId: 'hm-1',
      userId: 'user-1',
      type: ApplicationFormType.ABOUTME,
      formData: '{"q":"a"}',
      ...overrides,
    }) as unknown as ApplicationForm;

  beforeEach(async () => {
    jest.resetAllMocks();
    mockForms.claimFormForAttachment.mockImplementation(
      (applicationFormId: string) => Promise.resolve({ applicationFormId }),
    );
    mockForms.releaseAttachmentClaim.mockResolvedValue(undefined);
    mockForms.convertFormDataToXml.mockResolvedValue('<xml/>');
    mockForms.saveSiebelAttachmentId.mockResolvedValue(undefined);
    mockSiebel.createFormAttachment.mockResolvedValue({
      items: { Id: 'siebel-1' },
    });
    mockSiebel.createAttachment.mockResolvedValue({ items: { Id: 'icm-1' } });
    mockUsers.findOne.mockResolvedValue({
      first_name: 'Jane',
      last_name: 'Doe',
    });
    mockUserUtil.firstAndMiddleName.mockReturnValue({
      firstName: 'Jane',
      middleName: '',
    });
    mockUserUtil.toTitleCase.mockImplementation((s: string) => s);
    mockAttachments.findByHouseholdMemberId.mockResolvedValue([]);
    const module = await Test.createTestingModule({
      providers: [
        SrAttachmentService,
        { provide: ApplicationFormService, useValue: mockForms },
        { provide: SiebelApiService, useValue: mockSiebel },
        { provide: UserService, useValue: mockUsers },
        { provide: UserUtil, useValue: mockUserUtil },
        { provide: AttachmentsService, useValue: mockAttachments },
        { provide: 'PinoLogger:SrAttachmentService', useValue: mockLogger },
      ],
    }).compile();
    service = module.get(SrAttachmentService);
  });
  describe('forms', () => {
    it('attaches a form with data and saves the Siebel attachment id', async () => {
      const result = await service.attachFormsToSr(SR_ID, [form()], CONTEXT);

      expect(mockSiebel.createFormAttachment).toHaveBeenCalledWith(SR_ID, {
        fileName: ApplicationFormType.ABOUTME,
        template: getFormIdForFormType(ApplicationFormType.ABOUTME),
        xmlHierarchy: '<xml/>',
        fileContent: '{"q":"a"}',
      });
      expect(mockForms.saveSiebelAttachmentId).toHaveBeenCalledWith(
        'form-1',
        'siebel-1',
      );
      expect(result).toEqual({ attempted: 1, succeeded: 1 });
    });

    it('names consent forms after the person who completed them', async () => {
      await service.attachFormsToSr(
        SR_ID,
        [form({ type: ApplicationFormType.DISCLOSURECONSENT })],
        CONTEXT,
      );

      expect(mockSiebel.createFormAttachment).toHaveBeenCalledWith(
        SR_ID,
        expect.objectContaining({
          fileName: `Jane_Doe-${ApplicationFormType.DISCLOSURECONSENT}`,
        }),
      );
    });
    it('falls back to the form type as the filename when the user cannot be found', async () => {
      mockUsers.findOne.mockResolvedValue(null);

      await service.attachFormsToSr(
        SR_ID,
        [form({ type: ApplicationFormType.PCCCONSENT })],
        CONTEXT,
      );

      expect(mockSiebel.createFormAttachment).toHaveBeenCalledWith(
        SR_ID,
        expect.objectContaining({ fileName: ApplicationFormType.PCCCONSENT }),
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
        'Could not find household member for screening form - using default filename',
      );
    });
    it('uses the form type as the filename for a consent form with no user', async () => {
      await service.attachFormsToSr(
        SR_ID,
        [form({ type: ApplicationFormType.PCCCONSENT, userId: undefined })],
        CONTEXT,
      );

      expect(mockUsers.findOne).not.toHaveBeenCalled();
      expect(mockSiebel.createFormAttachment).toHaveBeenCalledWith(
        SR_ID,
        expect.objectContaining({ fileName: ApplicationFormType.PCCCONSENT }),
      );
    });
    it('does not re-attach a form that already has a Siebel attachment, and counts it as done', async () => {
      const result = await service.attachFormsToSr(
        SR_ID,
        [form({ siebelAttachmentId: 'siebel-old' })],
        CONTEXT,
      );

      expect(mockForms.claimFormForAttachment).not.toHaveBeenCalled();
      expect(mockSiebel.createFormAttachment).not.toHaveBeenCalled();
      expect(result).toEqual({ attempted: 1, succeeded: 1 });
    });
    it('skips a form with no data', async () => {
      const result = await service.attachFormsToSr(
        SR_ID,
        [form({ formData: undefined })],
        CONTEXT,
      );

      expect(mockSiebel.createFormAttachment).not.toHaveBeenCalled();
      expect(result).toEqual({ attempted: 1, succeeded: 0 });
    });
    it('skips a form another submission has already claimed', async () => {
      mockForms.claimFormForAttachment.mockResolvedValue(null);

      const result = await service.attachFormsToSr(SR_ID, [form()], CONTEXT);

      expect(mockSiebel.createFormAttachment).not.toHaveBeenCalled();
      expect(result.succeeded).toBe(0);
    });
    it('releases the claim, keeps going and warns when one form fails', async () => {
      mockSiebel.createFormAttachment
        .mockRejectedValueOnce(new Error('upload failed'))
        .mockResolvedValueOnce({ items: { Id: 'siebel-2' } });

      const result = await service.attachFormsToSr(
        SR_ID,
        [
          form({ applicationFormId: 'form-bad' }),
          form({ applicationFormId: 'form-ok' }),
        ],
        CONTEXT,
      );
      expect(mockForms.releaseAttachmentClaim).toHaveBeenCalledWith('form-bad');
      expect(mockForms.saveSiebelAttachmentId).toHaveBeenCalledWith(
        'form-ok',
        'siebel-2',
      );
      expect(result).toEqual({ attempted: 2, succeeded: 1 });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ failedAttachments: 1 }),
        'Some forms failed to attach to Siebel - submission continuing with partial attachments',
      );
    });
  });
  describe('user-attached forms', () => {
    const uploadedForm = form({
      type: ApplicationFormType.DISCLOSURECONSENT,
      userAttachedForm: true,
      formData: undefined,
    });
    it('uploads the member files instead of the form, and saves the ICM attachment id', async () => {
      mockAttachments.findByHouseholdMemberId.mockResolvedValue([
        { attachmentId: 'att-1' },
      ]);
      mockAttachments.findById.mockResolvedValue({
        attachmentId: 'att-1',
        fileName: 'signed.pdf',
        fileData: Buffer.from('x'),
        fileType: 'application/pdf',
        description: 'Signed consent',
      });
      await service.attachFormsToSr(SR_ID, [uploadedForm], CONTEXT);

      expect(mockSiebel.createFormAttachment).not.toHaveBeenCalled();
      expect(mockSiebel.createAttachment).toHaveBeenCalledWith(
        SR_ID,
        expect.objectContaining({
          fileName: 'signed.pdf',
          category: 'Consent',
          description: 'Signed consent',
        }),
      );
      expect(mockAttachments.saveIcmAttachmentId).toHaveBeenCalledWith(
        'att-1',
        'icm-1',
      );
    });

    it('does not upload a file that is already in ICM', async () => {
      mockAttachments.findByHouseholdMemberId.mockResolvedValue([
        { attachmentId: 'att-1', icmAttachmentId: 'icm-old' },
      ]);

      await service.attachFormsToSr(SR_ID, [uploadedForm], CONTEXT);

      expect(mockAttachments.findById).not.toHaveBeenCalled();
      expect(mockSiebel.createAttachment).not.toHaveBeenCalled();
    });
    it('logs and carries on when one upload fails', async () => {
      mockAttachments.findByHouseholdMemberId.mockResolvedValue([
        { attachmentId: 'att-bad' },
        { attachmentId: 'att-ok' },
      ]);
      mockAttachments.findById.mockImplementation((id: string) =>
        Promise.resolve({
          attachmentId: id,
          fileName: `${id}.pdf`,
          fileData: Buffer.from('x'),
          fileType: 'application/pdf',
        }),
      );
      mockSiebel.createAttachment
        .mockRejectedValueOnce(new Error('upload failed'))
        .mockResolvedValueOnce({ items: { Id: 'icm-2' } });

      await expect(
        service.attachFormsToSr(SR_ID, [uploadedForm], CONTEXT),
      ).resolves.toBeDefined();

      expect(mockAttachments.saveIcmAttachmentId).toHaveBeenCalledTimes(1);
      expect(mockAttachments.saveIcmAttachmentId).toHaveBeenCalledWith(
        'att-ok',
        'icm-2',
      );
    });

    it('skips an upload that has no file data', async () => {
      mockAttachments.findByHouseholdMemberId.mockResolvedValue([
        { attachmentId: 'att-empty' },
      ]);
      mockAttachments.findById.mockResolvedValue({
        attachmentId: 'att-empty',
        fileName: 'empty.pdf',
        fileData: undefined,
      });

      await service.attachFormsToSr(SR_ID, [uploadedForm], CONTEXT);

      expect(mockSiebel.createAttachment).not.toHaveBeenCalled();
      expect(mockAttachments.saveIcmAttachmentId).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { attachmentId: 'att-empty' },
        'Attachment not found or has no file data',
      );
    });

    it('skips an upload that cannot be found', async () => {
      mockAttachments.findByHouseholdMemberId.mockResolvedValue([
        { attachmentId: 'att-gone' },
      ]);
      mockAttachments.findById.mockResolvedValue(null);

      await service.attachFormsToSr(SR_ID, [uploadedForm], CONTEXT);

      expect(mockSiebel.createAttachment).not.toHaveBeenCalled();
    });

    it('logs and carries on when the member uploads cannot be listed', async () => {
      mockAttachments.findByHouseholdMemberId.mockRejectedValue(
        new Error('db down'),
      );

      await expect(
        service.attachFormsToSr(SR_ID, [uploadedForm], CONTEXT),
      ).resolves.toEqual({ attempted: 1, succeeded: 0 });

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ householdMemberId: 'hm-1' }),
        'Failed to fetch attachments for household member',
      );
    });
  });
});
