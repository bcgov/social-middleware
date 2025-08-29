import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class GetIcmContactQueryDto {
  @ApiProperty({
    description: 'Siebel SearchSpec query string',
    example: "([Last Name]='UL-Souers' AND [Birth Date]='05/18/1973')",
  })
  @IsString()
  SearchSpec!: string;

  @ApiPropertyOptional({
    description: 'Comma-separated list of fields to return from Siebel',
    example:
      'M/F, Row Id, Joined AKA Last Name, Joined AKA First Name, Deceased Flag, Primary Contact Address Id, Employee Flag, Joined AKA Middle Name, Deceased Date, Last Name, Middle Name, First Name',
  })
  @IsOptional()
  @IsString()
  fields?: string;

  // Add other query parameters as needed
}
