import { ApiProperty } from '@nestjs/swagger';
import { ApplicationStatus } from '../enums/application-status.enum';
import { ApplicationTypes } from '../enums/application-types.enum';

export class GetApplicationsDto {
    @ApiProperty()
    applicationId!: string;

    @ApiProperty()
    formId!: string;

    @ApiProperty()
    primary_applicantId!: string;

    @ApiProperty({ enum: ApplicationTypes })
    type!: ApplicationTypes;

    @ApiProperty({ enum: ApplicationStatus })
    status!: ApplicationStatus;

    @ApiProperty()
    submittedAt!: Date;

    @ApiProperty()
    updatedAt!: Date;
}
