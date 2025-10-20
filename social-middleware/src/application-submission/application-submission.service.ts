// application-submission.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApplicationSubmission } from './schemas/application-submission.schema';
import { ApplicationSubmissionStatus } from './enums/application-submission-status.enum';
import { UpdateSubmissionStatusDto } from './dto/update-submission-status.dto';

import { Model } from 'mongoose';

@Injectable()
export class ApplicationSubmissionService {
  constructor(
    @InjectModel(ApplicationSubmission.name)
    private applicationSubmissionModel: Model<ApplicationSubmission>,
  ) {}
  async createInitialSubmission(
    applicationId: string,
  ): Promise<ApplicationSubmission> {
    const initialSubmission = new this.applicationSubmissionModel({
      applicationId,
      status: ApplicationSubmissionStatus.Draft, // or CREATED
      createdAt: new Date(),
      submittedAt: null, // Will be set when actually submitted
      // Initialize any other required fields
    });

    return await initialSubmission.save();
  }

  async updateSubmissionStatus(
    applicationId: string,
    updateDto: UpdateSubmissionStatusDto,
  ): Promise<ApplicationSubmission> {
    // verify ownership before proceeding
    /*
    const application = await this.applicationService.findByIdAndUser(
      applicationId,
      userId,
    );

    if (!application) {
      throw new NotFoundException(`Application not found.`);
    } */

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
}
