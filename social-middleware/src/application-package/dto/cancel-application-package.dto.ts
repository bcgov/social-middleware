import { IsString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CancelApplicationPackageDto {
  @ApiProperty({
    description: 'The ID of the user creating the application package',
    example: '37fbe045-4be7-4226-b2e6-a0018f797b11',
  })
  @IsString()
  applicationPackageId!: string;

  @ApiProperty({
    description: 'The ID of the user creating the application package',
    example: '37fbe045-4be7-4226-b2e6-a0018f797b11',
  })
  @IsString()
  userId!: string;
}
