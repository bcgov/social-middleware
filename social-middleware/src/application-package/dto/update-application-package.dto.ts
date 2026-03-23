import { IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateApplicationPackageDto {
  @ApiProperty({
    description: 'Whether the applicant has a partner/spouse',
    example: 'true',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  hasPartner?: boolean;

  @ApiProperty({
    description: 'Whether the applicant has a household',
    example: 'true',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  hasHousehold?: boolean;

  @ApiProperty({
    description: 'Whether the applicant has a support network',
    example: 'true',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  hasSupportNetwork?: boolean;
}
