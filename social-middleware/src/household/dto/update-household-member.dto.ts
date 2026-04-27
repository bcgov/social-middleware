import {
  IsString,
  MinLength,
  MaxLength,
  IsDateString,
  IsEmail,
  IsOptional,
  ValidateIf,
} from 'class-validator';

export class UpdateHouseholdMemberDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  lastName!: string;

  @IsDateString()
  dateOfBirth!: string;

  @ValidateIf((o) => o.email !== '' && o.email != null)
  @IsEmail({}, { message: 'Please enter a valid email address' })
  @MaxLength(255)
  @IsOptional()
  email?: string;
}
