import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class GetIcmContactQueryDto {
  @ApiProperty({
    description: 'Contact Last Name',
    example: 'Johnson',
    required: true,
  })
  @IsString()
  lastName?: string;

  // Add other query parameters as needed
}
