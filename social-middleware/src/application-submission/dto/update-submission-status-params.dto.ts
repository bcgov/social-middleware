import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class UpdateSubmissionStatusParamsDto {
  @ApiProperty({
    description:
      'The ID of the application whose submission status is being updated',
    example: '4e4d305b-6de8-4fc8-98cf-fdc4f22111f0',
  })
  @IsUUID()
  applicationId!: string;
}
