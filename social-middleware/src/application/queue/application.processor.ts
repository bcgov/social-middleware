import { forwardRef, Inject } from '@nestjs/common';
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { v4 as uuidv4 } from 'uuid';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Application,
  ApplicationDocument,
} from '../schemas/application.schema';
import {
  FormParameters,
  FormParametersDocument,
} from '../schemas/form-parameters.schema';
import { FormType } from '../enums/form-type.enum';
import { CreateApplicationDto } from '../dto/create-application.dto';
import { PinoLogger } from 'nestjs-pino';
import { HouseholdService } from 'src/household/household.service';
import { UserService } from 'src/auth/user.service';
import { RelationshipToPrimary } from 'src/household/enums/relationship-to-primary.enum';
import { MemberTypes } from 'src/household/enums/member-types.enum';
import { ApplicationSubmissionService } from 'src/application-submission/application-submission.service';

@Processor('applicationQueue')
export class ApplicationProcessor {
  constructor(
    @InjectModel(Application.name)
    private readonly applicationModel: Model<ApplicationDocument>,
    @Inject(forwardRef(() => ApplicationSubmissionService))
    private readonly applicationSubmissionService: ApplicationSubmissionService,
    @InjectModel(FormParameters.name)
    private readonly formParametersModel: Model<FormParametersDocument>,
    private readonly logger: PinoLogger,
    private readonly householdService: HouseholdService,
    private readonly userService: UserService,
  ) {}

  @Process('create')
  async handleCreateJob(
    job: Job<{ dto: CreateApplicationDto; userId: string }>,
  ): Promise<{ formAccessToken: string }> {
    const { dto, userId } = job.data;

    const applicationId = uuidv4();
    const formAccessToken = uuidv4();

    try {
      this.logger.info('Processing job to create application');
      this.logger.debug(
        { applicationId, userId, formId: dto.formId },
        'Generated UUIDs',
      );

      const application = new this.applicationModel({
        applicationId,
        primary_applicantId: userId,
        formData: dto.formData ?? null,
      });

      const savedApplication = await application.save();
      this.logger.info({ applicationId }, 'Saved application to DB');

      // create initial submission
      await this.applicationSubmissionService.createInitialSubmission(
        String(savedApplication._id),
      );

      const formParameters = new this.formParametersModel({
        applicationId,
        type: FormType.New,
        formId: dto.formId,
        formAccessToken,
        formParameters: dto.formParameters,
      });

      await formParameters.save();
      this.logger.info({ formAccessToken }, 'Saved form parameters to DB');

      const user = await this.userService.findOne(userId);
      this.logger.debug({ user }, 'Fetched user data');

      // create the household with the primary applicant as the first member
      await this.householdService.createMember(applicationId, {
        applicationId,
        userId: userId,
        firstName: user.first_name,
        lastName: user.last_name,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        dateOfBirth: user.dateOfBirth,
        email: user.email,
        memberType: MemberTypes.Primary,
        relationshipToPrimary: RelationshipToPrimary.Self,
        requireScreening: true,
      });

      this.logger.info(`Application created via queue: ${applicationId}`);

      return { formAccessToken };
    } catch (error) {
      this.logger.error({ error }, 'Failed to create application in processor');
      throw error;
    }
  }
}
