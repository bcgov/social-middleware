import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID } from 'class-validator';
export class SubmitApplicationDto {
  @ApiProperty({
    description: 'Unique token associated with the form submission',
    example: 'f1ef0d90-7cf5-46e5-ab8e-f676ab14ff2d',
    type: String,
  })
  @IsUUID()
  readonly token!: string;
  @ApiProperty({
    description: 'Base64-encoded JSON string containing document data',
    example: 'eyJrZXkiOiAiVmFsdWUifQ==',
    type: String,
  })
  @IsString()
  readonly formJson!: string;
}
