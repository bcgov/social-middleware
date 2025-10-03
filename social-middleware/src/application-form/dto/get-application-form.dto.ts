import { ApiProperty } from '@nestjs/swagger';
import { ApplicationFormStatus } from '../enums/application-form-status.enum';
import { ApplicationFormType } from '../enums/application-form-types.enum';

export class GetApplicationFormDto {
  @ApiProperty()
  applicationId!: string;

  @ApiProperty()
  applicationPackageId!: string;

  @ApiProperty()
  formId!: string;

  @ApiProperty()
  userId!: string;

  //   @ApiProperty({ type: Object })
  //   formData!: Record<string, any>; // could also make this more specific with a dedicated DTO

  @ApiProperty({ enum: ApplicationFormType })
  type!: ApplicationFormType;

  @ApiProperty({ enum: ApplicationFormStatus })
  status!: ApplicationFormStatus;

  @ApiProperty()
  submittedAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
