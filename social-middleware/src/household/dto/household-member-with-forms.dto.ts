import { ApiProperty } from '@nestjs/swagger';
import { HouseholdMembers } from '../schemas/household-members.schema';
import { GetApplicationFormDto } from '../../application-form/dto/get-application-form.dto';

export class HouseholdMemberWithFormsDto {
  @ApiProperty({
    description: 'Household member details',
    type: () => HouseholdMembers,
  })
  householdMember!: HouseholdMembers;

  @ApiProperty({
    description: 'Application forms assigned to this household member',
    type: [GetApplicationFormDto],
  })
  applicationForms!: GetApplicationFormDto[];
}
