import { ApiProperty } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { AttachmentType } from '../enums/attachment-types.enum';

export class GetAttachmentDto {
  @ApiProperty()
  attachmentId!: string;

  @ApiProperty()
  applicationPackageId!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  householdMemberId?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  applicationFormId?: string | null;

  @ApiProperty({ enum: AttachmentType })
  attachmentType!: AttachmentType;

  @ApiProperty({ required: false })
  @IsOptional()
  icmAttachmentId?: string | null;

  @ApiProperty()
  fileName!: string;

  @ApiProperty()
  fileType!: string;

  @ApiProperty()
  fileSize!: number;

  @ApiProperty({ required: false })
  @IsOptional()
  description?: string;

  @ApiProperty()
  uploadedBy!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
