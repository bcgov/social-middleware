/* eslint-disable @typescript-eslint/no-unsafe-call */
import { IsString } from 'class-validator';

export class ValidateTokenDto {
  @IsString()
  token!: string;

  @IsString()
  userId!: string;
}
