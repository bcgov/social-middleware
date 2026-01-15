import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetApplicationPackageQueryDto {
  @ApiProperty({
    description: 'The applicationPackageId to reset',
    example: 'app-pkg-123',
  })
  @IsString()
  @IsNotEmpty()
  applicationPackageId!: string;
}
