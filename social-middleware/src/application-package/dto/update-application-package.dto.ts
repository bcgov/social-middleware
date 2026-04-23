import { IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateApplicationPackageDto {
  @ApiProperty({
    description: 'Whether the applicant has a partner/spouse',
    example: 'true',
  })
  @IsOptional()
  @IsBoolean()
  hasPartner!: boolean;

  @ApiProperty({
    description: 'Whether the applicant has a household',
    example: 'true',
  })
  @IsOptional()
  @IsBoolean()
  hasHousehold!: boolean;

  @ApiProperty({
    description: 'Whether the applicant has a support network',
    example: 'true',
  })
  @IsOptional()
  @IsBoolean()
  hasSupportNetwork!: boolean;
}
