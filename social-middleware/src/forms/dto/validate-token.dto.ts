/* eslint-disable @typescript-eslint/no-unsafe-call */
import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ValidateTokenDto {
  @ApiProperty({
    description: 'Form access token to be validated',
    example: 'a1b2c3d4e5f6',
  })
  @IsString()
  token!: string;

  @ApiProperty({
    description: 'Identifier of the user making the request',
    example: 'user12345',
  })
  @IsString()
  userId!: string;
}
