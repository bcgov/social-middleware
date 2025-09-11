import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssociateAccessCodeDto {
  @ApiProperty({ description: 'Access code string', example: 'ABC123XYZ' })
  @IsString()
  accessCode!: string;
}
