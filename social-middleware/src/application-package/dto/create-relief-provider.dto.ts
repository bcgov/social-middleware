import { PickType } from '@nestjs/swagger';
import { CreateAdditionalAdultDto } from './create-additional-adult.dto';

// A relief provider is identified by who they are; there is no relationship choice or move-in date
export class CreateReliefProviderDto extends PickType(
  CreateAdditionalAdultDto,
  ['firstName', 'lastName', 'dateOfBirth', 'genderType', 'email'] as const,
) {}
