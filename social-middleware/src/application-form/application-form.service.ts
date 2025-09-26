import {
  Injectable,
  InternalServerErrorException,
  //BadRequestException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { v4 as uuidv4 } from 'uuid';
import { Model } from 'mongoose';
import {
  ApplicationForm,
  ApplicationFormDocument,
} from './schemas/application-form.schema';
//import { ApplicationFormType } from './enums/application-form-types.enum';
import { FormType } from './enums/form-type.enum';
import {
  FormParameters,
  FormParametersDocument,
} from './schemas/form-parameters.schema';
import { CreateApplicationFormDto } from './dto/create-application-form.dto';
import { SubmitApplicationFormDto } from './dto/submit-application-form.dto';
import { NewTokenDto } from './dto/new-token.dto';
import { ApplicationFormStatus } from './enums/application-form-status.enum';
//import { GetApplicationsDto } from './dto/get-applications.dto';
//import { SubmitApplicationDto } from './dto/submit-application-dto';
//import { ApplicationStatus } from './enums/application-status.enum';
import { UserService } from 'src/auth/user.service';

@Injectable()
export class ApplicationFormService {
  constructor(
    @InjectModel(ApplicationForm.name)
    private applicationFormModel: Model<ApplicationFormDocument>,
    @InjectModel(FormParameters.name)
    private formParametersModel: Model<FormParametersDocument>,
    @InjectPinoLogger(ApplicationFormService.name)
    private readonly logger: PinoLogger,
    private readonly userService: UserService,
  ) {}

  async createApplicationForm(
    dto: CreateApplicationFormDto,
  ): Promise<{ applicationId: string }> {
    const applicationId = uuidv4();
    const formAccessToken = uuidv4();

    try {
      this.logger.info('Creating new application form');
      this.logger.debug(
        {
          applicationPackageId: dto.applicationPackageId,
          applicationId: applicationId,
          userId: dto.userId,
          formId: dto.formId,
          type: dto.type,
          formAccessToken: formAccessToken,
        },
        'Key Info',
      );

      const applicationForm = new this.applicationFormModel({
        applicationId,
        applicationPackageId: dto.applicationPackageId,
        userId: dto.userId,
        formId: dto.formId,
        type: dto.type,
        formData: null,
      });

      await applicationForm.save();

      this.logger.info({ applicationId }, 'Saved application form to DB');

      const newFormDto = {
        applicationId: applicationId,
        type: FormType.New,
        formId: dto.formId,
        formParameters: {
          formId: dto.formId,
          language: 'en',
        },
      };

      await this.newFormAccessToken(newFormDto, dto.userId);

      const formParameters = new this.formParametersModel({
        applicationId,
        type: FormType.New, // always new for new form parameters
        formId: dto.formId,
        formAccessToken,
        formParameters: {
          formId: dto.formId,
          language: 'en',
        },
      });

      await formParameters.save();
      this.logger.info({ formAccessToken }, 'Saved form parameters to DB');

      return { applicationId };
    } catch (error) {
      //const err = error as Error;
      //this.logger.error(err.name, 'Failed to create application');
      this.logger.error({ error }, 'Failed to create application');
      throw new InternalServerErrorException('Application creation failed.');
    }
  }

  async newFormAccessToken(dto: NewTokenDto, userId: string): Promise<string> {
    this.logger.info('Creating a new Form Access Token for user:', userId);
    this.logger.debug('Passed applicationId:', dto.applicationId);

    try {
      // check to see if the user owns the applicationForm
      const ownsForm = await this.confirmOwnership(dto.applicationId, userId);

      if (ownsForm) {
        // Get the latest form parameters for this application
        const latestFormParameters = await this.formParametersModel
          .findOne({ applicationId: dto.applicationId })
          .sort({ createdAt: -1 })
          .lean()
          .exec();

        const formAccessToken = uuidv4();

        if (latestFormParameters) {
          // Reuse existing parameters but with new token
          this.logger.info('Re-using form parameters');
          const formParamters = new this.formParametersModel({
            applicationId: dto.applicationId,
            type: latestFormParameters.type,
            formId: latestFormParameters.formId,
            formAccessToken: formAccessToken,
            formParameters: latestFormParameters.formParameters, // Reuse existing
          });
          await formParamters.save();
        } else {
          // Create new parameters using the dto
          this.logger.info('Creating new form parameters');
          if (dto.type && dto.formId && dto.formParameters) {
            const formParamters = new this.formParametersModel({
              applicationId: dto.applicationId,
              type: dto.type,
              formId: dto.formId,
              formAccessToken: formAccessToken,
              formParameters: dto.formParameters, // Reuse existing
            });
            await formParamters.save();
          } else {
            this.logger.error('Cannot create new token without form meta data');
            throw new InternalServerErrorException(
              'Failed to create new form access token',
            );
          }
        }
        return formAccessToken;
      } else {
        throw new InternalServerErrorException(
          'Invalid applicationForm or unauthorized access',
        );
      }
    } catch (error) {
      if (error instanceof NotFoundException) {
        // Re-throw NotFoundException (from the !formParameters check)
        throw error;
      }
      // Log and handle unexpected database errors
      this.logger.error(
        { error },
        `Error generating formAccessToken for application: ${dto.applicationId}`,
      );
      throw new InternalServerErrorException(
        'Failed to generate form access token',
      );
    }
  }

  /*

// service to create a screening application record, it should be the simlar to above
// but the main difference is that userId is optional; the primary applicant may be creating
// applicationForms for users who have not logged in yet:
// note that it creates an access code record that a new users can use to authorize their
// access to this form

// async createScreeningForm(
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
*/

  /*
Access code generator, move to an access code service
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

  // move to separate utility 
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

  // move to access code service
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
*/

  /*


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
  */

  /*
  refactor to align to the applicationForm naming convention.
  will be called by the application package service to return all forms for a user
  the userId should be part of the dto, which is extracted by the session token in the controller
  create another version that will return all application forms for an application package id

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
  */

  /* refactor to align to applicationForm naming convention;
     this should be called by a forms foundry endpoint in the controller
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
  */

  /*

  // delete an applicationForm, initiated by "Cancel Application" in the portal
  // typically, the cancel service in the application package module will iterate
  // through the various forms and delete them individually
  // it may be used in other situations though.
  // read comments and refactor legacy code as appropriate
  async cancelApplicationForm(
    dto: DeleteApplicationFormDto,
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

    // Delete form parameters
    await this.formParametersModel.deleteMany({ applicationId }).exec();

    // MOVE TO APPLICATION PACAKGE SERVICE:
    // Delete screening access codes
    await this.screeningAccessCodeModel
      .deleteMany({ parentApplicationId: applicationId })
      .exec();

    // Finally, delete the main application
    await this.applicationModel.findByIdAndDelete(application._id).exec();

    this.logger.info(
      { applicationId, userId },
      'ApplicationForm cancelled successfully',
    );
  }
    */

  async submitApplicationForm(dto: SubmitApplicationFormDto): Promise<void> {
    try {
      this.logger.info('Saving application form');

      const record = await this.formParametersModel
        .findOne({ formAccessToken: { $eq: dto.token } })
        .select('applicationId')
        .lean()
        .exec();

      if (!record) {
        throw new NotFoundException(`Token ${dto.token} not found`);
      }
      const updated = await this.applicationFormModel
        .findOneAndUpdate(
          { applicationId: record.applicationId },
          {
            $set: {
              formData: dto.formJson,
              status: ApplicationFormStatus.DRAFT,
            },
          },
          { new: true },
        )
        .exec();
      if (!updated) {
        throw new NotFoundException(
          `ApplicationForm ${record.applicationId} not found`,
        );
      }
      this.logger.info('ApplicationForm saved  to DB ', record.applicationId);
    } catch (err) {
      if (err instanceof HttpException) {
        // Re-throw known HTTP exceptions (404, 400)
        throw err;
      }
      // Log internal errors
      this.logger.error('Error submitting application form', err);
      throw new InternalServerErrorException('Could not save form data');
    }
  }

  async findByPackageAndUser(
    applicationPackageId: string,
    userId: string,
  ): Promise<ApplicationForm[]> {
    return await this.applicationFormModel
      .find({ applicationPackageId, userId })
      .select('applicationId type status createdAt updatedAt')
      .sort({ createdAt: 1 })
      .lean()
      .exec();
  }

  async confirmOwnership(
    applicationId: string,
    userId: string,
  ): Promise<boolean> {
    const applicationForm = await this.applicationFormModel
      .findOne({ applicationId, userId })
      .lean()
      .exec();
    return !!applicationForm;
  }

  async deleteByApplicationPackageId(
    parentApplicationId: string,
  ): Promise<void> {
    await this.applicationFormModel
      .deleteMany({ parentApplicationId: parentApplicationId })
      .exec();
  }
}
