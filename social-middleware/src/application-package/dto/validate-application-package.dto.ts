import { ApiProperty } from '@nestjs/swagger';

export class ValidateHouseholdCompletionDto {
  @ApiProperty({ description: 'Whether the household information is complete' })
  isComplete!: boolean;

  @ApiProperty({ description: 'List of validation errors', type: [String] })
  errors!: string[];

  @ApiProperty({
    description: 'Summary of validation results',
    type: Object,
    properties: {
      partnersRequired: { type: 'number' },
      partnersFound: { type: 'number' },
      householdMembersRequired: { type: 'boolean' },
      householdMembersFound: { type: 'number' },
      incompleteRecords: { type: 'array', items: { type: 'string' } },
    },
  })
  summary!: {
    partnersRequired: number;
    partnersFound: number;
    householdMembersRequired: boolean;
    householdMembersFound: number;
    incompleteRecords: string[];
  };
}
