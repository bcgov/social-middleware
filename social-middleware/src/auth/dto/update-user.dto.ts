// auth/dto/update-user.dto.ts
import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto';

export class UpdateUserDto extends PartialType(CreateUserDto) {}

// auth/dto/index.ts
export * from './create-user.dto';
export * from './update-user.dto';