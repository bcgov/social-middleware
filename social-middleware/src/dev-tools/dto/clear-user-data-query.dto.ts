import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ClearUserDataQueryDto {
  @ApiProperty({
    description: 'ID of the user to clear data for',
    example: '68adde979f5d77833d8412aa',
  })
  @IsString()
  @IsNotEmpty()
  userId!: string;
}
