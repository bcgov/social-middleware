import { ApiProperty } from '@nestjs/swagger';
import { ApplicationSubmissionStatus } from '../enums/application-submission-status.enum';
import { IsEnum } from 'class-validator';

export class UpdateSubmissionStatusDto {
  @ApiProperty({
    description: 'The new status of the application submission',
    enum: ApplicationSubmissionStatus,
  })
  @IsEnum(ApplicationSubmissionStatus)
  readonly status!: ApplicationSubmissionStatus;

  // to do: add other fields as necessary
}
