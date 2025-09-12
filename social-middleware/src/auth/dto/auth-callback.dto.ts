import { IsNotEmpty, IsString, IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AuthCallbackDto {
  @ApiProperty({
    description: 'Authorization code from BC Services Card',
    example:
      'd46c0743-7d28-48f8-a473-394b841c4f35.2ef8f2e8-81a8-48fe-9cb4-67b1da21eec0',
  })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty({
    description: 'Redirect URI after authentication',
    example: 'https://portal-url/auth/callback',
  })
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false }) // allow localhost
  redirect_uri!: string;
}
