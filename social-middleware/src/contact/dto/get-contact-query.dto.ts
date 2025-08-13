import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class GetContactQueryDto {
  @ApiProperty({
    description: 'Birth date for contact lookup',
    example: '1990-01-01',
  })
  @IsString()
  @IsNotEmpty()
  birthDate!: string;
}