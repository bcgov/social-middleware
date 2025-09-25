import {
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  //BadRequestException,
  //HttpException,
  //NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { v4 as uuidv4 } from 'uuid';
import { Model } from 'mongoose';
import {
  ApplicationForm,
  ApplicationFormDocument,
} from '../schemas/application-form.schema';
//import { ApplicationFormType } from './enums/application-form-types.enum';
import { FormType } from '../enums/form-type.enum';
import {
  FormParameters,
  FormParametersDocument,
} from '../schemas/form-parameters.schema';
import { CreateApplicationFormDto } from '../dto/create-application-form.dto';
//import { GetApplicationsDto } from './dto/get-applications.dto';
//import { SubmitApplicationDto } from './dto/submit-application-dto';
//import { ApplicationStatus } from './enums/application-status.enum';
import { UserService } from 'src/auth/user.service';
import {
  ApplicationFormType,
  getFormIdForFormType,
} from '../enums/application-form-types.enum';
import { ApplicationFormStatus } from '../enums/application-form-status.enum';
import { AccessCodeService } from './access-code.service';
import { GetApplicationFormDto } from '../dto/get-application-form.dto';
import { SubmitApplicationFormDto } from '../dto/submit-application-form-dto';
import { DeleteApplicationFormDto } from '../dto/delete-application-form.dto';
import {
  ApplicationPackage,
  ApplicationPackageDocument,
} from 'src/application-package/schema/application-package.schema';

@Injectable()
export class ApplicationFormService {
  constructor(
    @InjectModel(ApplicationForm.name)
    private applicationFormModel: Model<ApplicationFormDocument>,
    @InjectModel(FormParameters.name)
    private formParametersModel: Model<FormParametersDocument>,
    @InjectModel(ApplicationPackage.name)
    private applicationPackageModel: Model<ApplicationPackageDocument>,
    @InjectPinoLogger(ApplicationFormService.name)
    private readonly logger: PinoLogger,
    private readonly userService: UserService,
    private readonly accessCodeService: AccessCodeService,
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

      // BONUS: If you can figure out how to remove this you win

      const formParameters = new this.formParametersModel({
        applicationId,
        type: FormType.New, // always new for new form parameters
        formId: dto.formId,
        formAccessToken,
        formParameters: {
          formId: dto.formId,
          formParameters: { formId: dto.formId, language: 'en' },
        },
      });

      /*
            const formParameters = new this.formParametersModel({
              applicationId,
              type: FormType.New,
              formId: dto.formId,
              formAccessToken,
              formParameters: dto.formParameters,
            });
      */

      await formParameters.save();
      this.logger.info({ formAccessToken }, 'Saved form parameters to DB');

      return { applicationId };
    } catch (error) {
      this.logger.error({ error }, 'Failed to create application');
      throw new InternalServerErrorException('Application creation failed.');
    }
  }

  // service to create a screening application record, it should be the simlar to above
  // but the main difference is that userId is optional; the primary applicant may be creating
  // applicationForms for users who have not logged in yet:
  // note that it creates an access code record that a new users can use to authorize their
  // access to this form

  async createScreeningForm(
    parentApplicationId: string,
    householdMemberId: string,
    userId?: string, // optional
  ): Promise<{
    screeningApplicationId: string;
    accessCode?: string; // only if userId not provided
    expiresAt?: Date; // only if userId not provided
  }> {
    const screeningApplicationId = uuidv4();
    const accessCode = !userId
      ? this.accessCodeService.generateAccessCode()
      : undefined;
    const expiresAt = !userId
      ? new Date(Date.now() + 72 * 60 * 60 * 1000) // 72 hours
      : undefined;

    try {
      this.logger.info('Creating new screening application');

      // Create ApplicationForm-like record for screening
      const applicationForm = new this.applicationFormModel({
        applicationId: screeningApplicationId,
        applicationPackageId: parentApplicationId,
        userId: userId || null,
        type: userId
          ? ApplicationFormType.ABOUTME
          : ApplicationFormType.REFERRAL,
        status: ApplicationFormStatus.NEW,
        formData: null,
      });

      await applicationForm.save();
      this.logger.info(
        { screeningApplicationId },
        'Saved screening application form to DB',
      );

      // Create FormParameters-like record for access
      if (!userId) {
        const formParameters = new this.formParametersModel({
          applicationId: screeningApplicationId,
          type: FormType.New,
          formId: getFormIdForFormType(ApplicationFormType.REFERRAL),
          formAccessToken: accessCode,
          formParameters: {
            householdMemberId,
            parentApplicationId,
            expiresAt,
          },
        });

        await formParameters.save();
        this.logger.info(
          { accessCode, screeningApplicationId, expiresAt },
          'Saved form parameters (access code) to DB',
        );
      }

      return { screeningApplicationId, accessCode, expiresAt };
    } catch (error) {
      this.logger.error({ error }, 'Failed to create screening application');
      throw new InternalServerErrorException(
        'Screening application creation failed',
      );
    }
  }

  async getApplicationFormsByUser(
    userId: string,
  ): Promise<GetApplicationFormDto[]> {
    try {
      this.logger.info({ userId }, 'Fetching application forms for user');

      // Find all application forms for the user (exclude formData to reduce payload)
      const forms = await this.applicationFormModel
        .find({ userId }, { formData: 0 })
        .lean();

      if (!forms.length) {
        this.logger.info({ userId }, 'No application forms found for user');
        return [];
      }

      // Fetch corresponding formIds from FormParameters
      const applicationIds = forms.map((form) => form.applicationId);
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

      // Build final DTO array
      const results: GetApplicationFormDto[] = forms.map((form) => ({
        applicationId: form.applicationId,
        formId: formIdMap.get(form.applicationId) ?? '',
        userId: form.userId,
        type: form.type,
        status: form.status,
        submittedAt: form.submittedAt ?? null,
        updatedAt: form.updatedAt,
      }));

      this.logger.info(
        { userId, count: results.length },
        'Application forms fetched successfully',
      );

      return results;
    } catch (error) {
      this.logger.error({ error, userId }, 'Failed to fetch application forms');
      throw new InternalServerErrorException(
        'Failed to fetch application forms for user',
      );
    }
  }

  async getApplicationFormsByPackageId(
    applicationPackageId: string,
    userId: string,
  ): Promise<GetApplicationFormDto[]> {
    try {
      // Validate package ownership
      const appPackage = await this.applicationPackageModel
        .findOne({ applicationPackageId })
        .lean();

      if (!appPackage) {
        throw new NotFoundException(
          `Application package ${applicationPackageId} not found`,
        );
      }

      if (appPackage.userId !== userId) {
        throw new ForbiddenException(
          `User does not have access to this package`,
        );
      }
      this.logger.info(
        { applicationPackageId },
        'Fetching application forms for package',
      );

      const forms = await this.applicationFormModel
        .find({ applicationPackageId })
        .lean();

      if (!forms.length) {
        this.logger.info(
          { applicationPackageId },
          'No application forms found for package',
        );
        return [];
      }

      // Fetch corresponding formIds from FormParameters
      const applicationIds = forms.map((form) => form.applicationId);
      const formParameters = await this.formParametersModel
        .find(
          { applicationId: { $in: applicationIds } },
          { applicationId: 1, formId: 1 },
        )
        .lean();

      const formIdMap = new Map(
        formParameters.map((fp) => [fp.applicationId, fp.formId]),
      );

      const results: GetApplicationFormDto[] = forms.map((form) => ({
        applicationId: form.applicationId,
        formId: formIdMap.get(form.applicationId) ?? '',
        userId: form.userId,
        type: form.type,
        status: form.status,
        updatedAt: form.updatedAt,
        submittedAt: form.submittedAt ?? null,
      }));

      this.logger.info(
        { applicationPackageId, count: results.length },
        'Application forms fetched successfully',
      );
      return results;
    } catch (error) {
      this.logger.error(
        { error, applicationPackageId },
        'Failed to fetch application forms for package',
      );
      throw new InternalServerErrorException(
        'Failed to fetch application forms for package',
      );
    }
  }

  async submitApplication(dto: SubmitApplicationFormDto): Promise<void> {
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
      const updated = await this.applicationFormModel
        .findOneAndUpdate(
          { applicationId: record.applicationId },
          {
            $set: {
              formData: dto.formJson,
              status: ApplicationFormStatus.SUBMITTED,
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
      this.logger.error('Error submitting application', err);
      throw new InternalServerErrorException('Could not save form data');
    }
  }

  async cancelApplicationForm(dto: DeleteApplicationFormDto): Promise<void> {
    const { applicationId } = dto;

    this.logger.info({ applicationId }, 'Starting application cancellation');

    // check to see if the user owns the application in question
    const application = await this.applicationFormModel
      .findOne({ applicationId })
      .exec();

    if (!application) {
      throw new NotFoundException(`Application ${applicationId} not found`);
    }

    // Delete form parameters
    await this.formParametersModel.deleteMany({ applicationId }).exec();

    // Delete the main application
    await this.applicationFormModel.findByIdAndDelete(application._id).exec();

    this.logger.info(
      { applicationId },
      'ApplicationForm cancelled successfully',
    );
  }

  async findByIdAndUser(
    applicationId: string,
    userId: string,
  ): Promise<ApplicationFormDocument | null> {
    try {
      const application = await this.applicationFormModel
        .findOne({
          applicationId: applicationId,
          userId: userId,
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

  async findByPackageAndUser(
    applicationPackageId: string,
    userId: string,
  ): Promise<ApplicationForm[]> {
    return await this.applicationFormModel
      .find({ applicationPackageId, userId })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
  }

  async deleteByApplicationPackageId(
    parentApplicationId: string,
  ): Promise<void> {
    await this.applicationFormModel
      .deleteMany({ parentApplicationId: parentApplicationId })
      .exec();
  }
}
