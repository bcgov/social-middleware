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
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { v4 as uuidv4 } from 'uuid';
import { Model } from 'mongoose';
import { Application, ApplicationDocument } from './schemas/application.schema';
import { ApplicationTypes } from './enums/application-types.enum';
import {
  FormParameters,
  FormParametersDocument,
} from './schemas/form-parameters.schema';
import { CreateApplicationDto } from './dto/create-application.dto';
import { FormType } from './enums/form-type.enum';
import { GenderTypes } from 'src/household/enums/gender-types.enum';
import { GetApplicationsDto } from './dto/get-applications.dto';
import { SubmitApplicationDto } from './dto/submit-application-dto';
import { ApplicationStatus } from './enums/application-status.enum';
import { HouseholdService } from 'src/household/household.service';
//import { RelationshipToPrimary } from 'src/household/enums/relationship-to-primary.enum';
import { UserService } from 'src/auth/user.service';
import { ApplicationSubmissionService } from 'src/application-submission/application-submission.service';
import {
  ScreeningAccessCode,
  ScreeningAccessCodeDocument,
} from './schemas/screening-access-code.schema';
import { DeleteApplicationDto } from './dto/delete-application.dto';

@Injectable()
export class ApplicationService {
  constructor(
    @InjectModel(Application.name)
    private applicationModel: Model<ApplicationDocument>,
    @Inject(forwardRef(() => ApplicationSubmissionService))
    private readonly applicationSubmissionService: ApplicationSubmissionService,
    @InjectModel(FormParameters.name)
    private formParametersModel: Model<FormParametersDocument>,
    @InjectModel(ScreeningAccessCode.name) // add this line
    private screeningAccessCodeModel: Model<ScreeningAccessCodeDocument>,
    @InjectPinoLogger(ApplicationService.name)
    private readonly logger: PinoLogger,
    private readonly householdService: HouseholdService,
    private readonly userService: UserService,
    @InjectQueue('applicationQueue')
    private readonly applicationQueue: Queue,
  ) {}

  async createApplication(
    dto: CreateApplicationDto,
    userId: string,
  ): Promise<{ applicationId: string }> {
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

      //const user = await this.userService.findOne(userId);
      /*
      // create the household with the primary applicant as the first member
      await this.householdService.createMember(applicationId, {
        applicationId,
        userId: userId,
        firstName: user.first_name,
        lastName: user.last_name,
        dateOfBirth: user.dateOfBirth,
        email: user.email,
        genderType: this.sexToGenderType(user.sex),
        //memberType: MemberTypes.Primary,
        relationshipToPrimary: RelationshipToPrimary.Self,
        //requireScreening: true,
      });
      */

      //const job = await this.applicationQueue.add('create', {
      //  dto,
      //  userId,
      //});

      //this.logger.info(`Queued application creation with jobId ${job.id}`);
      //const result = (await job.finished()) as { formAccessToken: string };
      //return { formAccessToken: result.formAccessToken };
      return { applicationId };
    } catch (error) {
      this.logger.error({ error }, 'Failed to create application');
      throw new InternalServerErrorException('Application creation failed');
    }
  }

  // service to create a household screening application record
  async createHouseholdScreening(
    parentApplicationId: string,
    householdMemberId: string,
  ): Promise<{
    accessCode: string;
    screeningApplicationId: string;
    expiresAt: Date;
  }> {
    const screeningApplicationId = uuidv4();
    const accessCode = this.generateSecureAccessCode();
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours

    try {
      // create screening application record
      this.logger.info('Creating new screening application');

      const application = new this.applicationModel({
        applicationId: screeningApplicationId,
        parentApplicationId: parentApplicationId,
        type: ApplicationTypes.CaregiverScreening,
      });

      await application.save();

      this.logger.info({ screeningApplicationId }, 'Saved application to DB');

      // create access code record
      const accessCodeRecord = new this.screeningAccessCodeModel({
        accessCode,
        parentApplicationId,
        screeningApplicationId,
        householdMemberId,
        isUsed: false,
        expiresAt,
        attemptCount: 0,
        maxAttempts: 3,
      });

      await accessCodeRecord.save();
      this.logger.info(
        { accessCode, screeningApplicationId, expiresAt },
        'Created screening access code record',
      );

      return { accessCode, screeningApplicationId, expiresAt };
    } catch (error) {
      this.logger.error({ error }, 'Failed to create screening application');
      throw new InternalServerErrorException(
        'Screening application creation failed',
      );
    }
  }

  // secure code generation

  private generateSecureAccessCode(): string {
    //
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // removed confusing chars: 0,O,1,I
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  private sexToGenderType(sex: string): GenderTypes {
    switch (sex.toLowerCase()) {
      case 'male':
        return GenderTypes.ManBoy;
      case 'female':
        return GenderTypes.WomanGirl;
      case 'non-binary':
        return GenderTypes.NonBinary;
      default:
        return GenderTypes.Unspecified;
    }
  }

  async associateUserWithAccessCode(
    accessCode: string,
    userId: string,
    bcscUserData: {
      lastName: string;
      dateOfBirth: string;
      email?: string;
      firstName?: string;
    },
  ): Promise<{
    success: boolean;
    screeningApplicationId?: string;
    error?: string;
  }> {
    try {
      const accessCodeRecord = await this.screeningAccessCodeModel.findOne({
        accessCode,
        isUsed: false,
        expiresAt: { $gt: new Date() },
        attemptCount: { $lt: 3 },
      });

      if (!accessCodeRecord) {
        this.logger.warn(
          { accessCode },
          'Invalid, expired, or locked access code',
        );
        return { success: false, error: 'Invalid or expired access code' };
      }

      // lookup the household member data for validation
      const householdMember = await this.householdService.findById(
        accessCodeRecord.householdMemberId,
      );

      if (!householdMember) {
        this.logger.error(
          { householdMemberId: accessCodeRecord.householdMemberId },
          'Household member not found',
        );
        return { success: false, error: 'No match' };
      }

      this.logger.debug(
        { householdMember, bcscUserData },
        'Validating user against household member',
      );

      // validate user data against expected values
      const lastNameMatch =
        bcscUserData.lastName.toLowerCase().trim() ===
        householdMember.lastName.toLowerCase().trim();
      const dobMatch = bcscUserData.dateOfBirth === householdMember.dateOfBirth;

      if (!lastNameMatch || !dobMatch) {
        // increment attempt count
        await this.screeningAccessCodeModel.findByIdAndUpdate(
          accessCodeRecord._id,
          {
            $inc: { attemptCount: 1 },
          },
        );

        this.logger.warn(
          {
            accessCode,
            userId,
            expectedLastName: householdMember.lastName,
            providedLastName: bcscUserData.lastName.toLowerCase().trim(),
            expectedDOB: householdMember.dateOfBirth,
            providedDOB: bcscUserData.dateOfBirth,
            attemptCount: accessCodeRecord.attemptCount + 1,
          },
          'User validation failed for access code',
        );

        return {
          success: false,
          error: 'Personal information does not match.',
        };
      }

      // validation successful, associate user record to access code usage;
      await this.screeningAccessCodeModel.findByIdAndUpdate(
        accessCodeRecord._id,
        {
          assignedUserId: userId,
          isUsed: true,
        },
      );

      // associate screening record to user
      await this.applicationModel.findOneAndUpdate(
        { applicationId: accessCodeRecord.screeningApplicationId },
        { primary_applicantId: userId },
      );

      // associate the household record to the user
      await this.householdService.associateUserWithMember(
        accessCodeRecord.householdMemberId,
        userId,
      );

      this.logger.info(
        {
          accessCode,
          userId,
          householdMemberId: accessCodeRecord.householdMemberId,
          screeningApplicationId: accessCodeRecord.screeningApplicationId,
        },
        'Successfully validated and associated user with screening application',
      );

      return {
        success: true,
        screeningApplicationId: accessCodeRecord.screeningApplicationId,
      };
    } catch (error) {
      this.logger.error(
        { error, accessCode, userId },
        ' failed to associate user with access code',
      );
      throw new InternalServerErrorException('Failed to process access code');
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

  async cancelApplication(
    dto: DeleteApplicationDto,
    userId: string,
  ): Promise<void> {
    const { applicationId } = dto;

    this.logger.info(
      { applicationId, userId },
      'Starting application cancellation',
    );
    // check to see if the user owns the application in question
    const application = await this.applicationModel
      .findOne({
        applicationId,
        primary_applicantId: userId,
      })
      .exec();

    if (!application) {
      throw new NotFoundException(`Application ${applicationId} not found`);
    }

    // check if application can be cancelled
    if (application.status === ApplicationStatus.Submitted) {
      throw new BadRequestException('Cannot cancel submitted application');
    }
    // look for child applications
    const childApplications = await this.applicationModel
      .find({ parentApplicationId: applicationId })
      .exec();

    // delete child applications first
    if (childApplications.length > 0) {
      this.logger.info(
        { applicationId, childCount: childApplications.length },
        `Deleting ${childApplications.length} child application(s)`,
      );

      await this.applicationModel
        .deleteMany({ parentApplicationId: applicationId })
        .exec();
    }

    // look for household records
    const householdMembers =
      await this.householdService.findAllHouseholdMembers(applicationId);

    if (householdMembers.length > 0) {
      this.logger.info(
        { applicationId, householdCount: householdMembers.length },
        `Deleting ${householdMembers.length} household records`,
      );
      // delete household members
      //await this.householdService.deleteAllMembersByApplicationPackageId(
      //  applicationPackageId,
      //);
    }

    // look for application submission records
    //const submissionRecord = await this.applicationSubmissionService
    //.findByApplicationId(String(application._id));
    //if (submissionRecord) {
    //  this.logger.info({ applicationId }, 'Deleting application submission record');
    //  await this.applicationSubmissionService
    //  .deleteSubmission(String(application._id));
    //}

    // Delete form parameters
    await this.formParametersModel.deleteMany({ applicationId }).exec();

    // Delete screening access codes
    await this.screeningAccessCodeModel
      .deleteMany({ parentApplicationId: applicationId })
      .exec();

    // Finally, delete the main application
    await this.applicationModel.findByIdAndDelete(application._id).exec();

    this.logger.info(
      { applicationId, userId },
      'Application cancelled successfully',
    );
  }
}
