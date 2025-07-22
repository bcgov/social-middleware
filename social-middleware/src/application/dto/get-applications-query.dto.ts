import { IsString, IsNotEmpty } from 'class-validator';

export class GetApplicationsQueryDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;
}
