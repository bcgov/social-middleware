import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, IsBoolean, IsOptional } from 'class-validator';
import { MemberTypes } from '../enums/member-types.enum';
import { RelationshipToPrimary } from '../enums/relationship-to-primary.enum';

export class CreateHouseholdMemberDto {
  @ApiProperty({ example: 'user_456' })
  @IsString()
  applicationId!: string; // ID of the application this member belongs to

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
  email!: string;

  @ApiProperty({ enum: MemberTypes })
  @IsEnum(MemberTypes)
  memberType!: MemberTypes;

  @ApiProperty({ enum: RelationshipToPrimary })
  @IsEnum(RelationshipToPrimary)
  relationshipToPrimary!: RelationshipToPrimary;

  @ApiProperty({ default: false, required: false })
  @IsOptional()
  @IsBoolean()
  requireScreening?: boolean;
}
