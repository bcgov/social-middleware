// auth/dto/create-user.dto.ts
import {
  IsString,
  IsOptional,
  IsEmail,
  IsNotEmpty,
  MaxLength,
  IsPhoneNumber,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { GenderTypes } from '../../household/enums/gender-types.enum';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  bc_services_card_id!: string;

  @IsOptional() // it's possible that we get a mononym; in this case the first name will be blank
  @IsString()
  @Transform(({ value }: { value: any }) => {
    if (typeof value === 'string') {
      return value.trim() || '';
    }
    return '';
  })
  @MaxLength(50)
  first_name?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  last_name!: string;

  @IsString()
  @IsNotEmpty()
  sex!: string;

  @IsString()
  @IsNotEmpty()
  gender!: GenderTypes;

  @IsEmail()
  @IsNotEmpty()
  @MaxLength(350)
  email!: string;

  @IsPhoneNumber()
  @IsOptional()
  primaryPhone?: string;

  @IsPhoneNumber()
  @IsOptional()
  secondaryPhone?: string;

  @IsString()
  @IsNotEmpty()
  dateOfBirth!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  street_address!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  city!: string;

  @IsString()
  @IsNotEmpty()
  country!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  region!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  postal_code!: string;
}
