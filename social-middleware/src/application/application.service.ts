import {
  forwardRef,
  Inject,
  Injectable,
  InternalServerErrorException,
  BadRequestException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { v4 as uuidv4 } from 'uuid';
import { Model } from 'mongoose';
import { Application, ApplicationDocument } from './schemas/application.schema';
import {
  FormParameters,
  FormParametersDocument,
} from './schemas/form-parameters.schema';
import { CreateApplicationDto } from './dto/create-application.dto';
import { FormType } from './enums/form-type.enum';
import { GetApplicationsDto } from './dto/get-applications.dto';
import { SubmitApplicationDto } from './dto/submit-application-dto';
import { ApplicationStatus } from './enums/application-status.enum';
import { HouseholdService } from 'src/household/household.service';
import { MemberTypes } from 'src/household/enums/member-types.enum';
import { RelationshipToPrimary } from 'src/household/enums/relationship-to-primary.enum';
import { UserService } from 'src/auth/user.service';
import { ApplicationSubmissionService } from 'src/application-submission/application-submission.service';

@Injectable()
export class ApplicationService {
  constructor(
    @InjectModel(Application.name)
    private applicationModel: Model<ApplicationDocument>,
    @Inject(forwardRef(() => ApplicationSubmissionService))
    private readonly applicationSubmissionService: ApplicationSubmissionService,
    @InjectModel(FormParameters.name)
    private formParametersModel: Model<FormParametersDocument>,
    @InjectPinoLogger(ApplicationService.name)
    private readonly logger: PinoLogger,
    private readonly householdService: HouseholdService,
    private readonly userService: UserService,
  ) {}

  async createApplication(
    dto: CreateApplicationDto,
    userId: string,
  ): Promise<{ formAccessToken: string }> {
    const applicationId = uuidv4();
    const formAccessToken = uuidv4();

    try {
      this.logger.info('Creating new application');
      this.logger.debug(
        { applicationId, primary_applicantId: userId, formId: dto.formId },
        'Generated UUIDS',
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

      // create the household with the primary applicant as the first member
      await this.householdService.createMember(applicationId, {
        applicationId,
        userId: userId,
        firstName: user.first_name,
        lastName: user.last_name,
        dateOfBirth: user.dateOfBirth,
        email: user.email,
        memberType: MemberTypes.Primary,
        relationshipToPrimary: RelationshipToPrimary.Self,
        requireScreening: true,
      });

      return { formAccessToken };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          { error: error.message, stack: error.stack },
          'Error creating application',
        );
      } else {
        this.logger.error(
          { error },
          'Unknown error during application creation',
        );
      }
      throw new InternalServerErrorException('Failed to create application');
    }
  }

  async findByIdAndUser(
    applicationId: string,
    userId: string,
  ): Promise<ApplicationDocument | null> {
    try {
      const application = await this.applicationModel
        .findOne({
          _id: applicationId,
          primary_applicantId: userId,
        })
        .exec();

      return application;
    } catch (error) {
      this.logger.error(
        { error, applicationId, userId },
        'Error finding application by ID and user',
      );
      return null;
    }
  }

  async getApplicationsByUser(userId: string): Promise<GetApplicationsDto[]> {
    if (typeof userId !== 'string' || userId.trim() === '') {
      throw new BadRequestException('Invalid or missing userId');
    }
    try {
      this.logger.info({ userId }, 'Fetching applications for user');

      const applications = await this.applicationModel
        .find({ primary_applicantId: { $eq: userId } }, { formData: 0 })
        .lean();

      if (!applications.length) {
        this.logger.info({ userId }, 'No applications found for user');
        return [];
      }

      // Fetch corresponding formIds from FormParameters
      const applicationIds = applications.map((app) => app.applicationId);
      const formParameters = await this.formParametersModel
        .find(
          { applicationId: { $in: applicationIds } },
          { applicationId: 1, formId: 1 },
        )
        .lean();

      // Map applicationId -> formId
      const formIdMap = new Map(
        formParameters.map((fp) => [fp.applicationId, fp.formId]),
      );

      const results = applications.map((app) => ({
        applicationId: app.applicationId,
        formId: formIdMap.get(app.applicationId) ?? '',
        primary_applicantId: app.primary_applicantId,
        type: app.type,
        status: app.status,
        submittedAt: app.submittedAt,
        updatedAt: app.updatedAt,
      }));

      this.logger.info(
        { userId, count: results.length },
        'Applications fetched successfully',
      );
      return results;
    } catch (error) {
      this.logger.error({ error, userId }, 'Failed to fetch applications');
      throw new InternalServerErrorException('Failed to fetch applications');
    }
  }
  async submitApplication(dto: SubmitApplicationDto): Promise<void> {
    try {
      this.logger.info('Saving application');
      this.logger.debug('Saving application for token', dto.token);

      const record = await this.formParametersModel
        .findOne({ formAccessToken: { $eq: dto.token } })
        .select('applicationId')
        .lean()
        .exec();

      if (!record) {
        throw new NotFoundException(`Token ${dto.token} not found`);
      }
      const updated = await this.applicationModel
        .findOneAndUpdate(
          { applicationId: record.applicationId },
          {
            $set: {
              formData: dto.formJson,
              status: ApplicationStatus.Submitted,
            },
          },
          { new: true },
        )
        .exec();
      if (!updated) {
        throw new NotFoundException(
          `Application ${record.applicationId} not found`,
        );
      }
      this.logger.info('Application saved  to DB ', record.applicationId);
    } catch (err) {
      if (err instanceof HttpException) {
        // Re-throw known HTTP exceptions (404, 400)
        throw err;
      }
      // Log internal errors
      this.logger.error('Error submitting application', err);
      throw new InternalServerErrorException('Could not save form data');
    }
  }
}
