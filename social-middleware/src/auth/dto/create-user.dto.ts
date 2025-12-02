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
  last_name!: string;

  @IsString()
  sex!: string;

  @IsString()
  gender!: GenderTypes;

  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  dateOfBirth!: string;

  @IsString()
  street_address!: string;

  @IsString()
  city!: string;

  @IsString()
  country!: string;

  @IsString()
  region!: string;

  @IsString()
  postal_code!: string;
}
