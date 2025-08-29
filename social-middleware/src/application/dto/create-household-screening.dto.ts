import { IsNotEmpty, IsObject, IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateHouseholdScreeningDto {
  @ApiProperty({
    description: 'The parent application of the screening request',
    example: '7154bfc0-21d3-4de8-b0b5-76bdeff16c9e',
  })
  @IsString()
  formId!: string;

  @ApiProperty({
    description:
      'The UserID who will be screened; in general only initially populated when primary applicant',
    example: '68adde979f5d77833d8412aa',
  })
  @IsOptional()
  @IsObject()
  @IsNotEmpty()
  user!: {
    id: string;
    [key: string]: unknown;
  };
}
