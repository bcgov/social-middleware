import { IsString } from 'class-validator';

export class SendEmailDto {
  @IsString()
  to!: string[];

  @IsString()
  from!: string;

  @IsString()
  subject?: string;

  @IsString()
  body?: string;

  @IsString()
  bodyType?: 'html' | 'text';

  @IsString()
  cc?: string[];

  @IsString()
  bcc?: string[];

  @IsString()
  priority?: 'high' | 'normal' | 'low';
}
