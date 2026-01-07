import { ApiProperty } from '@nestjs/swagger';
import { AttachmentType } from '../enums/attachment-types.enum';

export class GetAttachmentDto {
  @ApiProperty()
  attachmentId!: string;

  @ApiProperty()
  applicationPackageId!: string;

  @ApiProperty({ required: false })
  householdMemberId?: string | null;

  @ApiProperty({ required: false })
  applicationFormId?: string | null;

  @ApiProperty({ enum: AttachmentType })
  attachmentType!: AttachmentType;

  @ApiProperty()
  fileName!: string;

  @ApiProperty()
  fileType!: string;

  @ApiProperty()
  fileSize!: number;

  @ApiProperty({ required: false })
  description?: string;

  @ApiProperty()
  uploadedBy!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
