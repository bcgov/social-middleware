import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsString,
  IsOptional,
  MinLength,
  MaxLength,
  IsEmail,
  ValidateIf,
} from 'class-validator';
import { RelationshipToPrimary } from '../enums/relationship-to-primary.enum';
import { GenderTypes } from '../enums/gender-types.enum';

export class CreateHouseholdMemberDto {
  @ApiProperty({ example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' })
  @IsString()
  applicationPackageId!: string;

  @ApiProperty({ example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' })
  @IsOptional() // will be auto-generated if not provided
  @IsString()
  householdMemberId?: string; // Unique ID for the household member (UUID)

  @IsOptional() // when created for a family member, we will not have a userId
  @IsString()
  userId?: string; // ID of the user this member represents (UUID)

  @IsString()
  @MinLength(1, { message: 'First name is required' })
  @MaxLength(50, { message: 'First name cannot exceed 50 characters' })
  firstName!: string;

  @IsString()
  @MinLength(1, { message: 'First name is required' })
  @MaxLength(50, { message: 'First name cannot exceed 50 characters' })
  lastName!: string;

  @IsString()
  dateOfBirth!: string; // ISO date string

  @ValidateIf(
    // email values will come in many formats so we have to be a bit wily in validating them
    (o) => o.email !== '' && o.email !== null && o.email !== undefined,
  )
  @IsEmail({}, { message: 'Please enter a valid email address' })
  @MaxLength(255, { message: 'Email cannot exceed 255 characters' })
  email?: string;

  @ApiProperty({ enum: RelationshipToPrimary })
  @IsEnum(RelationshipToPrimary)
  relationshipToPrimary!: RelationshipToPrimary;

  @ApiProperty({ enum: GenderTypes })
  @IsEnum(GenderTypes)
  @IsOptional()
  genderType!: GenderTypes;
}
