// auth/dto/create-user.dto.ts
import { IsString, IsOptional, IsEmail, IsNotEmpty } from 'class-validator';
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
  first_name?: string;

  @IsString()
  @IsNotEmpty()
  last_name!: string;

  @IsString()
  @IsNotEmpty()
  sex!: string;

  @IsString()
  @IsNotEmpty()
  gender!: GenderTypes;

  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  dateOfBirth!: string;

  @IsString()
  @IsNotEmpty()
  street_address!: string;

  @IsString()
  @IsNotEmpty()
  city!: string;

  @IsString()
  @IsNotEmpty()
  country!: string;

  @IsString()
  @IsNotEmpty()
  region!: string;

  @IsString()
  @IsNotEmpty()
  postal_code!: string;
}
