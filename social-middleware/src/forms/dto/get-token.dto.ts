import { IsString } from 'class-validator';

export class GetTokenDto {
  @IsString()
  applicationFormId!: string;
}
