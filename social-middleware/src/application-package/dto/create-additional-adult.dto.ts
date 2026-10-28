import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { GenderTypes } from '../../household/enums/gender-types.enum';
import { RelationshipToPrimary } from '../../household/enums/relationship-to-primary.enum';

// the relationships a caregiver can choose for a new adult in the home
export const ADDITIONAL_ADULT_RELATIONSHIPS = [
  RelationshipToPrimary.Child,
  RelationshipToPrimary.Parent,
  RelationshipToPrimary.Sibling,
  RelationshipToPrimary.Grandparent,
  RelationshipToPrimary.Grandchild,
  RelationshipToPrimary.Boarder,
  RelationshipToPrimary.Other,
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateAdditionalAdultDto {
  @ApiProperty({ enum: ADDITIONAL_ADULT_RELATIONSHIPS })
  @IsIn(ADDITIONAL_ADULT_RELATIONSHIPS)
  relationshipToPrimary!: RelationshipToPrimary;

  @IsString()
  @MinLength(1, { message: 'First name is required' })
  @MaxLength(50, { message: 'First name cannot exceed 50 characters' })
  firstName!: string;

  @IsString()
  @MinLength(1, { message: 'Last name is required' })
  @MaxLength(50, { message: 'Last name cannot exceed 50 characters' })
  lastName!: string;

  @Matches(ISO_DATE, { message: 'dateOfBirth must be YYYY-MM-DD' })
  dateOfBirth!: string;

  @ApiProperty({ enum: Object.values(GenderTypes) })
  @IsIn(Object.values(GenderTypes))
  genderType!: GenderTypes;

  @IsEmail({}, { message: 'Please enter a valid email address' })
  @MaxLength(255, { message: 'Email cannot exceed 255 characters' })
  email!: string;

  @Matches(ISO_DATE, { message: 'moveInDate must be YYYY-MM-DD' })
  moveInDate!: string;
}
