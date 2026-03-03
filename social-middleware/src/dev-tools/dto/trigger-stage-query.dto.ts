import { IsString, IsNotEmpty, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ServiceRequestStage } from '../../application-package/enums/application-package-status.enum';

export class TriggerStageQueryDto {
  @ApiProperty({ example: 'app-pkg-123' })
  @IsString()
  @IsNotEmpty()
  applicationPackageId!: string;

  @ApiProperty({
    enum: ServiceRequestStage,
    default: ServiceRequestStage.APPLICATION,
  })
  @IsEnum(ServiceRequestStage)
  stage: ServiceRequestStage = ServiceRequestStage.APPLICATION;
}
