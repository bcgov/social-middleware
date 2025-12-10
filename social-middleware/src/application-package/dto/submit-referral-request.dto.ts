import { IsEmail, IsOptional, IsString, Matches } from 'class-validator';

export class SubmitReferralRequestDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Matches(/^\(\d{3}\) \d{3}-\d{4}$/, {
    message: 'Primary phone must be in format (xxx) xxx-xxxx',
  })
  home_phone!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\(\d{3}\) \d{3}-\d{4}$/, {
    message: 'Secondary phone must be in format (xxx) xxx-xxxx',
  })
  alternate_phone?: string;
}
