import { ApiProperty } from '@nestjs/swagger';

export class GetIcmContactQueryDto {
  @ApiProperty({
    description: 'Siebel SearchSpec query string',
    example: "([Last Name]='UL-Souers' AND [Birth Date]='05/18/1973')",
  })
  SearchSpec!: string;

  // Add other query parameters as needed
}
