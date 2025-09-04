import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class GetServiceRequestQueryDto {
  @ApiProperty({
    description: 'Siebel SearchSpec query string',
    example: "([Last Name]='UL-Souers' AND [Birth Date]='05/18/1973')",
  })
  @IsString()
  SearchSpec!: string;

  @ApiPropertyOptional({
    description: 'Comma-separated list of fields to return from Siebel',
    example: 'Row Id, Type, Subtype',
  })
  @IsOptional()
  @IsString()
  fields?: string;
}
