import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsEnum, IsOptional, IsNotEmpty } from 'class-validator';
import { AttachmentType } from '../enums/attachment-types.enum';

export class CreateAttachmentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  applicationPackageId!: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  householdMemberId?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  applicationFormId?: string;

  @ApiProperty({ enum: AttachmentType })
  @IsEnum(AttachmentType)
  attachmentType!: AttachmentType;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  fileType!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  fileData!: string; //base 64 encoded

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  description?: string;
}
