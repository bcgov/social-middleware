import { IsString, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  ApplicationPackageSubType,
  ApplicationPackageSubSubType,
} from '../enums/application-package-subtypes.enum';

export class CreateApplicationPackageDto {
  @ApiProperty({
    description: 'The ID of the user creating the application package',
    example: '37fbe045-4be7-4226-b2e6-a0018f797b11',
    required: false,
  })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiProperty({
    description: 'The subtype of the application package',
    enum: ApplicationPackageSubType,
    example: ApplicationPackageSubType.FCH,
  })
  @IsEnum(ApplicationPackageSubType)
  subtype!: ApplicationPackageSubType;

  @ApiProperty({
    description: 'The sub-subtype of the application package',
    enum: ApplicationPackageSubSubType,
    example: ApplicationPackageSubSubType.FCH,
  })
  @IsEnum(ApplicationPackageSubSubType)
  subsubtype!: ApplicationPackageSubSubType;
}
