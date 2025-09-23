import { IsString, IsObject, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { FormType } from '../../application/enums/form-type.enum';

export class NewTokenDto {
  @ApiProperty({
    description:
      'The id of the application form these form parameters belong to',
    example: '37fbe045-4be7-4226-b2e6-a0018f797b11',
  })
  @IsString()
  applicationId!: string;

  @ApiProperty({
    description: 'The status of form being created',
    example: 'New',
  })
  @IsOptional()
  @IsString()
  type?: FormType;

  @ApiProperty({
    description: 'The ID of the form to associate',
    example: 'CF0001',
  })
  @IsOptional()
  @IsString()
  formId?: string;

  @ApiProperty({
    description: 'Form parameters to configure form. It can be empty initially',
    example: {
      allowEdit: true,
      prefillFields: ['name', 'email'],
    },
    required: false,
  })
  @IsOptional()
  @IsObject()
  formParameters?: Record<string, unknown>;
}
