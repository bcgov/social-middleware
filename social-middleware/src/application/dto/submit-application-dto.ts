import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsString, IsUUID } from 'class-validator';
export class SubmitApplicationDto {
  @ApiProperty({
    description: 'Unique token associated with the form submission',
    example: 'f1ef0d90-7cf5-46e5-ab8e-f676ab14ff2d',
    type: String,
  })
  @IsUUID()
  readonly token!: string;
  @ApiProperty({
    description: 'Username of the person submitting the form',
    example: 'john_doe',
    type: String,
  })
  @IsString()
  readonly user!: string;
  @ApiProperty({
    description: 'Form data in JSON format',
    example: { field1: 'value1', field2: 'value2' },
    type: Object,
  })
  @IsObject()
  readonly formJson!: Record<string, any>;
}
