import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Attachment, AttachmentDocument } from './schemas/attachment.schema';
import { CreateAttachmentDto } from './dto/create-attachment.dto';
import { GetAttachmentDto } from './dto/get-attachment.dto';

@Injectable()
export class AttachmentsService {
  constructor(
    @InjectModel(Attachment.name)
    private attachmentModel: Model<AttachmentDocument>,
    @InjectPinoLogger(AttachmentsService.name)
    private readonly logger: PinoLogger,
  ) {}

  async create(
    dto: CreateAttachmentDto,
    userId: string,
  ): Promise<AttachmentDocument> {
    this.logger.info(
      {
        applicationPackageId: dto.applicationPackageId,
        attachmentType: dto.attachmentType,
        fileName: dto.fileName,
        userId,
      },
      'Creating attachment',
    );

    const attachment = new this.attachmentModel({
      ...dto,
      fileSize: Buffer.from(dto.fileData, 'base64').length,
      uploadedBy: userId,
    });

    const saved = await attachment.save();

    this.logger.info(
      { attachmentId: saved.attachmentId },
      'Attachment created successfully',
    );

    return saved;
  }

  async findByApplicationPackageId(
    applicationPackageId: string,
    userId: string,
  ): Promise<GetAttachmentDto[]> {
    const attachments = await this.attachmentModel
      .find({ applicationPackageId, userId })
      .select('-fileData') // Exclude file data for list view
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    return attachments as GetAttachmentDto[];
  }

  async findByHouseholdMemberId(
    householdMemberId: string,
  ): Promise<GetAttachmentDto[]> {
    const attachments = await this.attachmentModel
      .find({ householdMemberId })
      .select('-fileData')
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    return attachments as GetAttachmentDto[];
  }

  async findById(attachmentId: string): Promise<AttachmentDocument | null> {
    return await this.attachmentModel.findOne({ attachmentId }).lean().exec();
  }

  async findByIdAndUser(
    attachmentId: string,
    userId: string,
  ): Promise<AttachmentDocument | null> {
    return await this.attachmentModel
      .findOne({ attachmentId, userId })
      .lean()
      .exec();
  }

  async delete(attachmentId: string, userId: string): Promise<boolean> {
    this.logger.info({ attachmentId, userId }, 'Deleting attachment');

    const result = await this.attachmentModel
      .findOneAndDelete({
        attachmentId,
        uploadedBy: userId, // Ensure user owns the attachment
      })
      .exec();

    if (!result) {
      throw new NotFoundException('Attachment not found or access denied');
    }

    this.logger.info({ attachmentId }, 'Attachment deleted successfully');
    return true;
  }

  async deleteByApplicationPackageId(
    applicationPackageId: string,
  ): Promise<void> {
    await this.attachmentModel.deleteMany({ applicationPackageId }).exec();
  }
}
