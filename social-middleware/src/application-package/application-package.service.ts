// application-submission.service.ts

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { v4 as uuidv4 } from 'uuid';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ApplicationPackage } from './schema/application-package.schema';
import { ApplicationPackageStatus } from './enums/application-package-status.enum';
import { ApplicationFormService } from '../application-form/application-form.service';
import { ApplicationFormType } from '../application-form/enums/application-form-types.enum';
import { CreateApplicationPackageDto } from './dto/create-application-package.dto';

import { Model } from 'mongoose';

@Injectable()
export class ApplicationPackageService {
  constructor(
    @InjectModel(ApplicationPackage.name)
    private applicationPackageModel: Model<ApplicationPackage>,
    private readonly applicationFormService: ApplicationFormService,
    @InjectPinoLogger(ApplicationFormService.name)
    private readonly logger: PinoLogger,
  ) {}
  async createApplicationPackage(
    dto: CreateApplicationPackageDto,
  ): Promise<ApplicationPackage> {
    //TODO: LOG
    this.logger.info(
      {
        userId: dto.userId,
        subtype: dto.subtype,
        subsubtype: dto.subsubtype,
      },
      'Starting Application with DTO',
    );

    const initialSubmission = new this.applicationPackageModel({
      applicationPackageId: uuidv4(),
      userId: dto.userId,
      subtype: dto.subtype,
      subsubtype: dto.subsubtype,
      status: ApplicationPackageStatus.DRAFT,
    });

    //TODO: Initialize Household Creation

    const result = await initialSubmission.save();

    // create referral as the first application Form
    const referralDto = {
      applicationPackageId: result.applicationPackageId,
      formId: 'CF0001', // TODO: Make data driven
      userId: dto.userId,
      type: ApplicationFormType.REFERRAL,
      formParameters: {},
    };

    const referral =
      await this.applicationFormService.createApplicationForm(referralDto);

    this.logger.info(
      {
        applicationPackageId: result.applicationPackageId,
        referralApplicationId: referral.applicationId,
      },
      'Created referral form for application package',
    );

    return result;
  }

  /*
  async updateSubmissionStatus(
    applicationId: string,
    updateDto: UpdateSubmissionStatusDto,
  ): Promise<ApplicationSubmission> {
    // verify ownership before proceeding
*/
  /*
    const application = await this.applicationService.findByIdAndUser(
      applicationId,
      userId,
    );

    if (!application) {
      throw new NotFoundException(`Application not found.`);
    } */
  /*
    const submission = await this.applicationSubmissionModel.findOneAndUpdate(
      { applicationId },
      {
        ...updateDto,
        updatedAt: new Date(),
      },
      { new: true, runValidators: true },
    );

    if (!submission) {
      throw new NotFoundException(
        `Submission not found for application ID: ${applicationId}`,
      );
    }

    //if (application.userId !== submission.userId) {

    return submission;
  }

*/
}
