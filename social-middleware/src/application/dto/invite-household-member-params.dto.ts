import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InviteHouseholdMemberParamsDto {
  @ApiProperty({
    description: 'Application ID',
    example: 'a8a6a5f0-1234-4bcd-9ef0-567890abcdef',
  })
  @IsUUID()
  applicationId!: string;

  @ApiProperty({
    description: 'Household Member ID',
    example: 'b1c2d3e4-5678-4fgh-9ijk-1234567890lm',
  })
  @IsUUID()
  householdMemberId!: string;
}
