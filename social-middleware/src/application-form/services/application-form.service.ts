import {
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { v4 as uuidv4 } from 'uuid';
import { Model } from 'mongoose';
import {
  ApplicationForm,
  ApplicationFormDocument,
} from '../schemas/application-form.schema';
import { FormType } from '../enums/form-type.enum';
import {
  FormParameters,
  FormParametersDocument,
} from '../schemas/form-parameters.schema';
import { CreateApplicationFormDto } from '../dto/create-application-form.dto';
import {
  ApplicationFormType,
  getFormIdForFormType,
} from '../enums/application-form-types.enum';
import { ApplicationFormStatus } from '../enums/application-form-status.enum';
import { AccessCodeService } from '../../household/services/access-code.service';
import { GetApplicationFormDto } from '../dto/get-application-form.dto';
import { DeleteApplicationFormDto } from '../dto/delete-application-form.dto';
import {
  ApplicationPackage,
  ApplicationPackageDocument,
} from 'src/application-package/schema/application-package.schema';
import { NewTokenDto } from '../dto/new-token.dto';
import { SubmitApplicationFormDto } from '../dto/submit-application-form.dto';

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
    private readonly accessCodeService: AccessCodeService,
  ) {}

  async createApplicationForm(
    dto: CreateApplicationFormDto,
  ): Promise<{ applicationFormId: string }> {
    const applicationFormId = uuidv4();
    const formAccessToken = uuidv4();

    try {
      this.logger.info('Creating new application form');
      this.logger.debug(
        {
          applicationPackageId: dto.applicationPackageId,
          applicationFormId: applicationFormId,
          userId: dto.userId,
          formId: dto.formId,
          type: dto.type,
          formAccessToken: formAccessToken,
        },
        'Key Info',
      );

      const applicationForm = new this.applicationFormModel({
        applicationFormId,
        applicationPackageId: dto.applicationPackageId,
        userId: dto.userId,
        formId: dto.formId,
        type: dto.type,
        formData: null,
      });

      await applicationForm.save();

      this.logger.info({ applicationFormId }, 'Saved application form to DB');

      const newFormDto = {
        applicationFormId: applicationFormId,
        type: FormType.New,
        formId: dto.formId,
        formParameters: {
          formId: dto.formId,
          language: 'en',
        },
      };

      await this.newFormAccessToken(newFormDto);

      return { applicationFormId };
    } catch (error) {
      this.logger.error({ error }, 'Failed to create application');
      throw new InternalServerErrorException('Application creation failed.');
    }
  }

  async createScreeningForm(
    applicationPackageId: string,
    householdMemberId: string,
    //userId?: string, // optional
  ): Promise<{
    screeningApplicationFormId: string;
    accessCode?: string; // only if userId not provided
    expiresAt?: Date; // only if userId not provided
  }> {
    try {
      this.logger.info('Creating new screening record');
      const screeningDto = {
        applicationPackageId: applicationPackageId,
        formId: getFormIdForFormType(ApplicationFormType.SCREENING),
        //userId: null,
        type: ApplicationFormType.SCREENING,
        formParameters: {},
      };

      const screeningApplicationFormId =
        await this.createApplicationForm(screeningDto);

      const { accessCode, expiresAt } =
        await this.accessCodeService.createAccessCode(
          applicationPackageId,
          screeningApplicationFormId.applicationFormId,
          householdMemberId,
        );

      //const screeningApplicationId = uuidv4();
      //const accessCode = !userId
      //  ? this.accessCodeService.generateAccessCode()
      //  : undefined;
      //const expiresAt = !userId
      //  ? new Date(Date.now() + 72 * 60 * 60 * 1000) // 72 hours
      //  : undefined;

      return {
        screeningApplicationFormId:
          screeningApplicationFormId.applicationFormId,
        accessCode,
        expiresAt,
      };
    } catch (error) {
      this.logger.error({ error }, 'Failed to create screening application');
      throw new InternalServerErrorException(
        'Screening application creation failed',
      );
    }
  }

  async newFormAccessToken(dto: NewTokenDto): Promise<string> {
    this.logger.debug('Passed applicationFormIdX:', dto.applicationFormId);

    try {
      // Get the latest form parameters for this application
      const latestFormParameters = await this.formParametersModel
        .findOne({ applicationFormId: { $eq: dto.applicationFormId } })
        .sort({ createdAt: -1 })
        .lean()
        .exec();

      const formAccessToken = uuidv4();

      if (latestFormParameters) {
        // Reuse existing parameters but with new token
        this.logger.info('Re-using form parameters');
        const formParamters = new this.formParametersModel({
          applicationFormId: dto.applicationFormId,
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
            applicationFormId: dto.applicationFormId,
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
    } catch (error) {
      if (error instanceof NotFoundException) {
        // Re-throw NotFoundException (from the !formParameters check)
        throw error;
      }
      // Log and handle unexpected database errors
      this.logger.error(
        { error },
        `Error generating formAccessToken for application: ${dto.applicationFormId}`,
      );
      throw new InternalServerErrorException(
        'Failed to generate form access token',
      );
    }
  }

  async confirmOwnership(
    applicationFormId: string,
    userId: string,
  ): Promise<boolean> {
    const applicationForm = await this.applicationFormModel
      .findOne({ applicationFormId: { $eq: applicationFormId }, userId })
      .lean()
      .exec();
    return !!applicationForm;
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
      const applicationFormIds = forms.map((form) => form.applicationFormId);
      const formParameters = await this.formParametersModel
        .find(
          { applicationFormId: { $in: applicationFormIds } },
          { applicationFormId: 1, formId: 1 },
        )
        .lean();

      // Map applicationId -> formId
      const formIdMap = new Map(
        formParameters.map((fp) => [fp.applicationFormId, fp.formId]),
      );

      // Build final DTO array
      const results: GetApplicationFormDto[] = forms.map((form) => ({
        applicationFormId: form.applicationFormId,
        applicationPackageId: form.applicationPackageId,
        formId: formIdMap.get(form.applicationFormId) ?? '',
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
      const applicationFormIds = forms.map((form) => form.applicationFormId);
      const formParameters = await this.formParametersModel
        .find(
          { applicationFormId: { $in: applicationFormIds } },
          { applicationFormId: 1, formId: 1 },
        )
        .lean();

      const formIdMap = new Map(
        formParameters.map((fp) => [fp.applicationFormId, fp.formId]),
      );

      const results: GetApplicationFormDto[] = forms.map((form) => ({
        applicationFormId: form.applicationFormId,
        applicationPackageId: form.applicationPackageId,
        formId: formIdMap.get(form.applicationFormId) ?? '',
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

  // used by front end to determine the current state of the applicationForm
  async getApplicationFormById(
    applicationFormId: string,
    userId: string,
  ): Promise<GetApplicationFormDto | null> {
    try {
      this.logger.info(
        { applicationFormId, userId },
        'Fetching application form by ID',
      );

      // Find the application form (without formData to keep response light)
      const form = await this.applicationFormModel
        .findOne(
          {
            applicationFormId: { $eq: applicationFormId },
            userId: { $eq: userId },
          },
          { formData: 0 },
        )
        .lean()
        .exec();

      if (!form) {
        this.logger.info(
          { applicationFormId, userId },
          'Application form not found or access denied',
        );
        return null;
      }

      // Get the corresponding formId from FormParameters
      const formParameters = await this.formParametersModel
        .findOne(
          { applicationFormId: { $eq: applicationFormId } },
          { formId: 1 },
        )
        .lean()
        .exec();

      const result: GetApplicationFormDto = {
        applicationFormId: form.applicationFormId,
        applicationPackageId: form.applicationPackageId,
        formId: formParameters?.formId ?? '',
        userId: form.userId,
        type: form.type,
        status: form.status,
        submittedAt: form.submittedAt ?? null,
        updatedAt: form.updatedAt,
      };

      this.logger.info(
        { applicationFormId, userId },
        'Application form fetched successfully',
      );

      return result;
    } catch (error) {
      this.logger.error(
        { error, applicationFormId, userId },
        'Failed to fetch application form by ID',
      );
      throw new InternalServerErrorException(
        'Failed to fetch application form',
      );
    }
  }

  async submitApplicationForm(dto: SubmitApplicationFormDto): Promise<void> {
    try {
      this.logger.info('Saving application');
      this.logger.debug('Saving application for token', dto.token);

      const record = await this.formParametersModel
        .findOne({ formAccessToken: { $eq: dto.token } })
        .select('applicationFormId')
        .lean()
        .exec();

      if (!record) {
        throw new NotFoundException(`Token ${dto.token} not found`);
      }
      const updated = await this.applicationFormModel
        .findOneAndUpdate(
          { applicationFormId: record.applicationFormId },
          {
            $set: {
              formData: dto.jsonToSave,
              status: ApplicationFormStatus.DRAFT,
            },
          },
          { new: true },
        )
        .exec();
      if (!updated) {
        throw new NotFoundException(
          `Application ${record.applicationFormId} not found`,
        );
      }
      this.logger.info('Application saved  to DB ', record.applicationFormId);
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
    const { applicationFormId } = dto;

    this.logger.info(
      { applicationFormId },
      'Starting application cancellation',
    );

    // check to see if the user owns the application in question
    const application = await this.applicationFormModel
      .findOne({ applicationFormId })
      .exec();

    if (!application) {
      throw new NotFoundException(`Application ${applicationFormId} not found`);
    }

    // Delete form parameters
    await this.formParametersModel.deleteMany({ applicationFormId }).exec();

    // Delete the main application
    await this.applicationFormModel.findByIdAndDelete(application._id).exec();

    this.logger.info(
      { applicationFormId },
      'ApplicationForm cancelled successfully',
    );
  }

  async findByIdAndUser(
    applicationFormId: string,
    userId: string,
  ): Promise<ApplicationFormDocument | null> {
    try {
      const application = await this.applicationFormModel
        .findOne({
          applicationFormId: applicationFormId,
          userId: userId,
        })
        .exec();

      return application;
    } catch (error) {
      this.logger.error(
        { error, applicationFormId, userId },
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

  // returns application form metadata, without formData
  async findShortByPackageAndUser(
    applicationPackageId: string,
    userId: string,
  ): Promise<ApplicationForm[]> {
    return await this.applicationFormModel
      .find({ applicationPackageId, userId })
      .select('-formData')
      .sort({ createdAt: 1 })
      .lean()
      .exec();
  }

  async deleteByApplicationPackageId(
    applicationPackageId: string,
  ): Promise<void> {
    await this.applicationFormModel
      .deleteMany({ applicationPackageId: applicationPackageId })
      .exec();
  }
}
