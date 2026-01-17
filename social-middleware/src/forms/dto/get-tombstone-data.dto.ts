import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class GetTombstoneDataDto {
  @ApiProperty({
    description:
      'Form access token to retrieve user tombstone data for form pre-population',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsString()
  @IsNotEmpty()
  formAccessToken!: string;
}
