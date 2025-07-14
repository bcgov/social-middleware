// src/application/dto/create-application.dto.ts
import { IsUUID, IsNotEmpty, IsObject, IsString } from 'class-validator';

export class CreateApplicationDto {
  @IsUUID()
  formId!: string;

  @IsObject()
  @IsNotEmpty()
  user!: {
    id: string;
    [key: string]: any;
  };

  @IsString()
  type!: string;

  @IsObject()
  formParameters!: Record<string, any>;
}
