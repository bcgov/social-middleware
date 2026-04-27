import { IsString, IsOptional } from 'class-validator';

export class SendEmailDto {
  @IsString()
  to!: string[];

  @IsString()
  from!: string;

  @IsString()
  @IsOptional()
  subject?: string;

  @IsString()
  @IsOptional()
  body?: string;

  @IsString()
  @IsOptional()
  bodyType?: 'html' | 'text';

  @IsString()
  @IsOptional()
  cc?: string[];

  @IsString()
  @IsOptional()
  bcc?: string[];

  @IsString()
  @IsOptional()
  priority?: 'high' | 'normal' | 'low';
}
