import {
  IsNotEmpty,
  IsObject,
  IsString,
  IsEnum,
  IsOptional,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ApplicationFormType } from '../enums/application-form-types.enum';
//import { ApplicationFormStatus } from '../enums/application-form-status.enum';

export class CreateApplicationFormDto {
  @ApiProperty({
    description:
      'The id of the application package record this application form belongs to',
    example: '37fbe045-4be7-4226-b2e6-a0018f797b11',
  })
  @IsString()
  applicationPackageId!: string;

  @ApiProperty({
    description: 'The ID of the form to associate',
    example: 'CF0001',
  })
  @IsString()
  formId!: string;

  @ApiProperty({
    description: 'The id of the user initiating the application form',
    example: '37fbe045-4be7-4226-b2e6-a0018f797b11',
  })
  @IsOptional()
  @IsObject()
  @IsNotEmpty()
  userId!: string;

  @ApiProperty({
    description: 'The type of application being created',
    enum: ApplicationFormType,
    example: ApplicationFormType.REFERRAL,
    required: false,
  })
  @IsOptional()
  @IsEnum(ApplicationFormType)
  type!: ApplicationFormType;

  @ApiProperty({
    description: 'Form parameters to configure form. It can be empty initially',
    example: {
      allowEdit: true,
      prefillFields: ['name', 'email'],
    },
    required: false,
  })
  @IsObject()
  formParameters!: Record<string, unknown>;

  @ApiProperty({
    description: 'Optional initial form data',
    example: {
      name: 'Jane Doe',
      age: 34,
    },
    required: false,
  })
  @IsOptional()
  @IsObject()
  formData?: Record<string, unknown>;
}
