import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import { SessionAuthGuard } from 'src/auth/session-auth.guard';
import { SessionUtil } from 'src/common/utils/session.util';
import { HouseholdService } from 'src/household/services/household.service';
import { UserService } from '../../auth/user.service';
import { AttachmentsController } from '../attachments.controller';
import { AttachmentsService } from '../attachments.service';
import { AttachmentType } from '../enums/attachment-types.enum';

describe('AttachmentsController', () => {
  let controller: AttachmentsController;

  const APPLICATION_PACKAGE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const HOUSEHOLD_MEMBER_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
  const ATTACHMENT_ID = 'c3d4e5f6-a7b8-9012-cdef-123456789012';
  const USER_ID = 'user-001';

  const mockSessionUtil = {
    extractUserIdFromRequest: jest.fn().mockReturnValue(USER_ID),
  };

  const mockAttachmentsService = {
    create: jest.fn(),
    findByApplicationPackageId: jest.fn(),
    findByHouseholdMemberId: jest.fn(),
    findByIdAndUser: jest.fn(),
    delete: jest.fn(),
  };

  const mockUserService = {
    findOne: jest.fn(),
  };

  const mockHouseholdService = {
    verifyUserOwnsHouseholdMemberPackage: jest.fn(),
  };

  const mockRequest = {} as Request;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSessionUtil.extractUserIdFromRequest.mockReturnValue(USER_ID);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AttachmentsController],
      providers: [
        { provide: AttachmentsService, useValue: mockAttachmentsService },
        { provide: SessionUtil, useValue: mockSessionUtil },
        { provide: HouseholdService, useValue: mockHouseholdService },
        { provide: UserService, useValue: mockUserService },
      ],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AttachmentsController>(AttachmentsController);
  });

  describe('uploadAttachment', () => {
    const dto = {
      applicationPackageId: APPLICATION_PACKAGE_ID,
      attachmentType: AttachmentType.MEDICAL_ASSESSMENT,
      fileName: 'test-file',
      fileType: 'pdf',
      fileData: 'base64encodeddata',
    };
    const mockAttachment = { attachmentId: ATTACHMENT_ID };

    it('calls service with dto and userId extracted from request', async () => {
      mockAttachmentsService.create.mockResolvedValue(mockAttachment);
      await controller.uploadAttachment(dto, mockRequest);
      expect(mockAttachmentsService.create).toHaveBeenCalledWith(dto, USER_ID);
    });

    it('returns the created attachment', async () => {
      mockAttachmentsService.create.mockResolvedValue(mockAttachment);
      const result = await controller.uploadAttachment(dto, mockRequest);
      expect(result).toEqual(mockAttachment);
    });

    it('throws HttpException 500 when service throws', async () => {
      mockAttachmentsService.create.mockRejectedValue(new Error('DB error'));
      await expect(
        controller.uploadAttachment(dto as any, mockRequest),
      ).rejects.toThrow(
        new HttpException(
          'Failed to upload attachment',
          HttpStatus.INTERNAL_SERVER_ERROR,
        ),
      );
    });
  });

  describe('getByApplicationPackage', () => {
    const mockAttachments = [{ attachmentId: ATTACHMENT_ID }];

    it('calls service with packageId and userId', async () => {
      mockAttachmentsService.findByApplicationPackageId.mockResolvedValue(
        mockAttachments,
      );
      await controller.getByApplicationPackage(
        APPLICATION_PACKAGE_ID,
        mockRequest,
      );
      expect(
        mockAttachmentsService.findByApplicationPackageId,
      ).toHaveBeenCalledWith(APPLICATION_PACKAGE_ID, USER_ID);
    });

    it('returns the attachments', async () => {
      mockAttachmentsService.findByApplicationPackageId.mockResolvedValue(
        mockAttachments,
      );
      const result = await controller.getByApplicationPackage(
        APPLICATION_PACKAGE_ID,
        mockRequest,
      );
      expect(result).toEqual(mockAttachments);
    });
  });

  describe('getByApplicationPackageAndHouseholdMemberId', () => {
    const mockAttachments = [{ attachmentId: ATTACHMENT_ID }];

    it('verifies ownership before fetching', async () => {
      mockHouseholdService.verifyUserOwnsHouseholdMemberPackage.mockResolvedValue(
        true,
      );
      mockAttachmentsService.findByHouseholdMemberId.mockResolvedValue(
        mockAttachments,
      );

      await controller.getByApplicationPackageAndHouseholdMemberId(
        HOUSEHOLD_MEMBER_ID,
        mockRequest,
      );

      expect(
        mockHouseholdService.verifyUserOwnsHouseholdMemberPackage,
      ).toHaveBeenCalledWith(HOUSEHOLD_MEMBER_ID, USER_ID);
    });

    it('calls service with householdMemberId when user owns the package', async () => {
      mockHouseholdService.verifyUserOwnsHouseholdMemberPackage.mockResolvedValue(
        true,
      );
      mockAttachmentsService.findByHouseholdMemberId.mockResolvedValue(
        mockAttachments,
      );

      await controller.getByApplicationPackageAndHouseholdMemberId(
        HOUSEHOLD_MEMBER_ID,
        mockRequest,
      );

      expect(
        mockAttachmentsService.findByHouseholdMemberId,
      ).toHaveBeenCalledWith(HOUSEHOLD_MEMBER_ID);
    });

    it('returns the attachments', async () => {
      mockHouseholdService.verifyUserOwnsHouseholdMemberPackage.mockResolvedValue(
        true,
      );
      mockAttachmentsService.findByHouseholdMemberId.mockResolvedValue(
        mockAttachments,
      );

      const result =
        await controller.getByApplicationPackageAndHouseholdMemberId(
          HOUSEHOLD_MEMBER_ID,
          mockRequest,
        );

      expect(result).toEqual(mockAttachments);
    });

    it('throws ForbiddenException and does not call service when user does not own the package', async () => {
      mockHouseholdService.verifyUserOwnsHouseholdMemberPackage.mockResolvedValue(
        false,
      );

      await expect(
        controller.getByApplicationPackageAndHouseholdMemberId(
          HOUSEHOLD_MEMBER_ID,
          mockRequest,
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(
        mockAttachmentsService.findByHouseholdMemberId,
      ).not.toHaveBeenCalled();
    });
  });

  describe('downloadAttachment', () => {
    const mockAttachment = {
      attachmentId: ATTACHMENT_ID,
      fileData: 'base64data',
    };

    it('calls service with attachmentId and userId', async () => {
      mockAttachmentsService.findByIdAndUser.mockResolvedValue(mockAttachment);
      await controller.downloadAttachment(ATTACHMENT_ID, mockRequest);
      expect(mockAttachmentsService.findByIdAndUser).toHaveBeenCalledWith(
        ATTACHMENT_ID,
        USER_ID,
      );
    });

    it('returns the attachment', async () => {
      mockAttachmentsService.findByIdAndUser.mockResolvedValue(mockAttachment);
      const result = await controller.downloadAttachment(
        ATTACHMENT_ID,
        mockRequest,
      );
      expect(result).toEqual(mockAttachment);
    });

    it('throws HttpException 404 when attachment is not found', async () => {
      mockAttachmentsService.findByIdAndUser.mockResolvedValue(null);
      await expect(
        controller.downloadAttachment(ATTACHMENT_ID, mockRequest),
      ).rejects.toThrow(
        new HttpException('Attachment not found', HttpStatus.NOT_FOUND),
      );
    });
  });

  describe('uploadInServiceTraining', () => {
    const dto = {
      attachmentType: AttachmentType.IN_SERVICE_TRAINING_CERTIFICATE,
      fileName: 'cert',
      fileType: 'pdf',
      fileData: 'base64',
    };

    it('throws BadRequestException when user has no active resource case', async () => {
      mockUserService.findOne.mockResolvedValue({ resource_case_id: null });
      await expect(
        controller.uploadInServiceTraining(dto as any, mockRequest),
      ).rejects.toThrow(BadRequestException);
    });

    it('sets resourceCaseId and calls service', async () => {
      mockUserService.findOne.mockResolvedValue({ resource_case_id: 'case-1' });
      mockAttachmentsService.create.mockResolvedValue({
        attachmentId: ATTACHMENT_ID,
      });

      await controller.uploadInServiceTraining(dto, mockRequest);

      expect(mockAttachmentsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceCaseId: 'case-1',
          applicationPackageId: undefined,
        }),
        USER_ID,
      );
    });
  });

  describe('deleteAttachment', () => {
    it('calls service with attachmentId and userId', async () => {
      mockAttachmentsService.delete.mockResolvedValue(true);
      await controller.deleteAttachment(ATTACHMENT_ID, mockRequest);
      expect(mockAttachmentsService.delete).toHaveBeenCalledWith(
        ATTACHMENT_ID,
        USER_ID,
      );
    });

    it('returns success message', async () => {
      mockAttachmentsService.delete.mockResolvedValue(true);
      const result = await controller.deleteAttachment(
        ATTACHMENT_ID,
        mockRequest,
      );
      expect(result).toEqual({
        success: true,
        message: 'Attachment deleted successfully',
      });
    });

    it('rethrows NotFoundException when attachment is not owned by user', async () => {
      mockAttachmentsService.delete.mockRejectedValue(
        new NotFoundException('Attachment not found or access denied'),
      );
      await expect(
        controller.deleteAttachment(ATTACHMENT_ID, mockRequest),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
