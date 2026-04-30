import { ApiProperty } from '@nestjs/swagger';

export class HouseholdMemberScreeningStatusDto {
  @ApiProperty()
  householdMemberId!: string;

  @ApiProperty()
  applicationPackageId!: string;

  @ApiProperty()
  memberType!: string;

  @ApiProperty()
  screeningInfoProvided!: boolean;
}
