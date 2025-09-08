import {
  IsUUID,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DeleteApplicationDto {
  @ApiProperty({
    description: 'The applicationId to be deleted',
    example: '4e4d305b-6de8-4fc8-98cf-fdc4f22111f0',
  })
  @IsUUID()
  applicationId!: string;
}