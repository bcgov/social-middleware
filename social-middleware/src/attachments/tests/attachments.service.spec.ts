import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { AttachmentsService } from '../attachments.service';
import { Attachment } from '../schemas/attachment.schema';
import { AttachmentType } from '../enums/attachment-types.enum';

describe('AttachmentsService', () => {
  let service: AttachmentsService;

  const ATTACHMENT_ID = 'c3d4e5f6-a7b8-9012-cdef-123456789012';
  const APPLICATION_PACKAGE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const HOUSEHOLD_MEMBER_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
  const USER_ID = 'user-001';

  const mockSave = jest.fn();

  const mockQuery = {
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn(),
  };

  const mockAttachmentModel = Object.assign(
    jest.fn().mockImplementation((data: Record<string, unknown>) => ({
      ...data,
      save: mockSave,
    })),
    {
      find: jest.fn().mockReturnValue(mockQuery),
      findOne: jest.fn(),
      findOneAndDelete: jest.fn(),
      findOneAndUpdate: jest.fn(),
      deleteMany: jest.fn(),
    },
  );
  mockAttachmentModel.find = jest.fn().mockReturnValue(mockQuery);
  mockAttachmentModel.findOne = jest.fn();
  mockAttachmentModel.findOneAndDelete = jest.fn();
  mockAttachmentModel.findOneAndUpdate = jest.fn();
  mockAttachmentModel.deleteMany = jest.fn();

  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn(),
  };

  const mockAttachmentDoc = {
    attachmentId: ATTACHMENT_ID,
    applicationPackageId: APPLICATION_PACKAGE_ID,
    householdMemberId: HOUSEHOLD_MEMBER_ID,
    applicationFormId: null,
    attachmentType: AttachmentType.MEDICAL_ASSESSMENT,
    fileName: 'test-file',
    fileType: 'pdf',
    fileSize: 1024,
    description: '',
    uploadedBy: USER_ID,
    icmAttachmentId: null,
    sentToICMAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockQuery.select.mockReturnThis();
    mockQuery.sort.mockReturnThis();
    mockQuery.lean.mockReturnThis();
    mockQuery.exec.mockResolvedValue([]);
    mockAttachmentModel.find.mockReturnValue(mockQuery);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttachmentsService,
        {
          provide: getModelToken(Attachment.name),
          useValue: mockAttachmentModel,
        },
        {
          provide: `PinoLogger:${AttachmentsService.name}`,
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get<AttachmentsService>(AttachmentsService);
  });

  describe('create', () => {
    const dto = {
      applicationPackageId: APPLICATION_PACKAGE_ID,
      householdMemberId: HOUSEHOLD_MEMBER_ID,
      applicationFormId: null,
      attachmentType: AttachmentType.MEDICAL_ASSESSMENT,
      fileName: 'test-file',
      fileType: 'pdf',
      fileData: Buffer.from('hello world').toString('base64'),
    };

    it('constructs the model with dto fields and uploadedBy', async () => {
      mockSave.mockResolvedValue(mockAttachmentDoc);
      await service.create(dto as any, USER_ID);
      expect(mockAttachmentModel).toHaveBeenCalledWith(
        expect.objectContaining({ ...dto, uploadedBy: USER_ID }),
      );
    });

    it('calculates fileSize from base64 fileData', async () => {
      mockSave.mockResolvedValue(mockAttachmentDoc);
      await service.create(dto as any, USER_ID);
      const expectedSize = Buffer.from(dto.fileData, 'base64').length;
      expect(mockAttachmentModel).toHaveBeenCalledWith(
        expect.objectContaining({ fileSize: expectedSize }),
      );
    });

    it('saves and returns the attachment document', async () => {
      mockSave.mockResolvedValue(mockAttachmentDoc);
      const result = await service.create(dto as any, USER_ID);
      expect(mockSave).toHaveBeenCalled();
      expect(result).toEqual(mockAttachmentDoc);
    });
  });

  describe('findByApplicationPackageId', () => {
    it('queries by applicationPackageId and uploadedBy userId', async () => {
      mockQuery.exec.mockResolvedValue([]);
      await service.findByApplicationPackageId(APPLICATION_PACKAGE_ID, USER_ID);
      expect(mockAttachmentModel.find).toHaveBeenCalledWith({
        applicationPackageId: APPLICATION_PACKAGE_ID,
        uploadedBy: USER_ID,
      });
    });

    it('excludes fileData from the query', async () => {
      mockQuery.exec.mockResolvedValue([]);
      await service.findByApplicationPackageId(APPLICATION_PACKAGE_ID, USER_ID);
      expect(mockQuery.select).toHaveBeenCalledWith('-fileData');
    });

    it('sorts results by createdAt descending', async () => {
      mockQuery.exec.mockResolvedValue([]);
      await service.findByApplicationPackageId(APPLICATION_PACKAGE_ID, USER_ID);
      expect(mockQuery.sort).toHaveBeenCalledWith({ createdAt: -1 });
    });

    it('includes icmAttachmentId and sentToICMAt in the returned DTOs', async () => {
      const doc = {
        ...mockAttachmentDoc,
        icmAttachmentId: 'icm-123',
        sentToICMAt: new Date('2026-02-01'),
      };
      mockQuery.exec.mockResolvedValue([doc]);
      const result = await service.findByApplicationPackageId(
        APPLICATION_PACKAGE_ID,
        USER_ID,
      );
      expect(result[0].icmAttachmentId).toBe('icm-123');
      expect(result[0].sentToICMAt).toEqual(new Date('2026-02-01'));
    });

    it('returns empty array when no attachments found', async () => {
      mockQuery.exec.mockResolvedValue([]);
      const result = await service.findByApplicationPackageId(
        APPLICATION_PACKAGE_ID,
        USER_ID,
      );
      expect(result).toEqual([]);
    });
  });

  describe('findByHouseholdMemberId', () => {
    it('queries by householdMemberId', async () => {
      mockQuery.exec.mockResolvedValue([]);
      await service.findByHouseholdMemberId(HOUSEHOLD_MEMBER_ID);
      expect(mockAttachmentModel.find).toHaveBeenCalledWith({
        householdMemberId: HOUSEHOLD_MEMBER_ID,
      });
    });

    it('includes sentToICMAt in the returned DTOs', async () => {
      const doc = { ...mockAttachmentDoc, sentToICMAt: new Date('2026-02-01') };
      mockQuery.exec.mockResolvedValue([doc]);
      const result = await service.findByHouseholdMemberId(HOUSEHOLD_MEMBER_ID);
      expect(result[0].sentToICMAt).toEqual(new Date('2026-02-01'));
    });

    it('excludes fileData from the query', async () => {
      mockQuery.exec.mockResolvedValue([]);
      await service.findByHouseholdMemberId(HOUSEHOLD_MEMBER_ID);
      expect(mockQuery.select).toHaveBeenCalledWith('-fileData');
    });
  });

  describe('delete', () => {
    it('deletes by attachmentId and uploadedBy to enforce ownership', async () => {
      mockAttachmentModel.findOneAndDelete = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockAttachmentDoc),
      });
      await service.delete(ATTACHMENT_ID, USER_ID);
      expect(mockAttachmentModel.findOneAndDelete).toHaveBeenCalledWith({
        attachmentId: ATTACHMENT_ID,
        uploadedBy: USER_ID,
      });
    });

    it('returns true on successful deletion', async () => {
      mockAttachmentModel.findOneAndDelete = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockAttachmentDoc),
      });
      const result = await service.delete(ATTACHMENT_ID, USER_ID);
      expect(result).toBe(true);
    });

    it('throws NotFoundException when attachment is not found or not owned by user', async () => {
      mockAttachmentModel.findOneAndDelete = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });
      await expect(service.delete(ATTACHMENT_ID, USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteByApplicationPackageId', () => {
    it('deletes all attachments for the given package', async () => {
      mockAttachmentModel.deleteMany = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ deletedCount: 3 }),
      });
      await service.deleteByApplicationPackageId(APPLICATION_PACKAGE_ID);
      expect(mockAttachmentModel.deleteMany).toHaveBeenCalledWith({
        applicationPackageId: APPLICATION_PACKAGE_ID,
      });
    });
  });

  describe('saveIcmAttachmentId', () => {
    it('updates the attachment with icmAttachmentId and sentToICMAt', async () => {
      mockAttachmentModel.findOneAndUpdate = jest
        .fn()
        .mockResolvedValue(mockAttachmentDoc);

      await service.saveIcmAttachmentId(ATTACHMENT_ID, 'icm-abc');

      expect(mockAttachmentModel.findOneAndUpdate).toHaveBeenCalledWith(
        { attachmentId: ATTACHMENT_ID },
        expect.objectContaining({
          icmAttachmentId: 'icm-abc',
          sentToICMAt: expect.any(Date) as Date,
        }),
      );
    });
  });
});
