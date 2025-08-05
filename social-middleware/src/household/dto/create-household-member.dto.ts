import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, IsBoolean, IsOptional } from 'class-validator';
import { MemberTypes } from '../enums/member-types.enum';
import { RelationshipToPrimary } from '../enums/relationship-to-primary.enum';

export class CreateHouseholdMemberDto {
  @ApiProperty({ example: 'user_456' })
  @IsString()
  userId!: string;

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
