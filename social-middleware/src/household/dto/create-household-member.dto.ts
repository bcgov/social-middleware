import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, IsOptional } from 'class-validator';
import { RelationshipToPrimary } from '../enums/relationship-to-primary.enum';
import { GenderTypes } from '../enums/gender-types.enum';

export class CreateHouseholdMemberDto {
  @ApiProperty({ example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' })
  @IsString()
  applicationPackageId!: string;
  //@ApiProperty({ example: 'user_456' })
  //@IsString()
  //applicationId!: string; // ID of the application this member belongs to

  @ApiProperty({ example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' })
  @IsOptional() // will be auto-generated if not provided
  @IsString()
  householdMemberId?: string; // Unique ID for the household member (UUID)

  @IsOptional() // when created for a family member, we will not have a userId
  @IsString()
  userId?: string; // ID of the user this member represents (UUID)

  @IsString()
  firstName!: string;
  @IsString()
  lastName!: string;

  @IsString()
  dateOfBirth!: string; // ISO date string
  @IsString()
  @IsOptional()
  email!: string;

  @ApiProperty({ enum: RelationshipToPrimary })
  @IsEnum(RelationshipToPrimary)
  relationshipToPrimary!: RelationshipToPrimary;

  @ApiProperty({ enum: GenderTypes })
  @IsEnum(GenderTypes)
  genderType!: GenderTypes;
}
