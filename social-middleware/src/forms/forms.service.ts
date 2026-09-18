import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PinoLogger } from 'nestjs-pino';
import {
  ApplicationForm,
  ApplicationFormDocument,
} from 'src/application-form/schemas/application-form.schema';
import {
  FormParameters,
  FormParametersDocument,
} from 'src/application-form/schemas/form-parameters.schema';
import { ApplicationFormService } from '../application-form/services/application-form.service';
import { UserProfileResponse } from '../auth/interfaces/user-profile-response.interface';
import { UserService } from '../auth/user.service';
import { ValidateTokenDto } from './dto/validate-token.dto';

@Injectable()
export class FormsService {
  constructor(
    private readonly configService: ConfigService,
    @InjectModel(FormParameters.name)
    private formParametersModel: Model<FormParametersDocument>,
    @InjectModel(ApplicationForm.name)
    private applicationFormModel: Model<ApplicationFormDocument>,
    //@InjectPinoLogger(ApplicationFormService.name)
    private applicationFormService: ApplicationFormService,
    private readonly userService: UserService,
    private readonly logger: PinoLogger,
  ) {}
  async validateTokenAndGetParameters(dto: ValidateTokenDto): Promise<any> {
    this.logger.info('Validating form access token');
    const token = dto.token;
    this.logger.info('Checking whether form access token exists');

    let record;
    let expiryOfTokenInMs;
    try {
      const minutes = this.configService.get<number>(
        'FORM_ACCESS_TOKEN_EXPIRY_MINUTES',
        30,
      );
      expiryOfTokenInMs = minutes * 60 * 1000;
      // Fetch the form params for this token
      record = await this.formParametersModel
        .findOne({ formAccessToken: { $eq: token } })
        .select('formParameters createdAt -_id')
        .lean()
        .exec();
    } catch (err) {
      // Log and handle only unexpected DB errors
      this.logger.error({ err }, 'Error validating token');
      throw new InternalServerErrorException('Failed to validate token');
    }
    // If not found, throw 404 error
    if (!record) {
      throw new NotFoundException(
        `No form parameters found for token ${token}`,
      );
    }
    this.logger.info('Succesfully found form access token');
    this.logger.info('Checking whether form access token is expired');

    // Check if createdAt is within the expiry time
    const ageOfTokenInMs = Date.now() - new Date(record.createdAt).getTime();
    if (ageOfTokenInMs > expiryOfTokenInMs) {
      throw new BadRequestException('Token has expired');
    }

    // Return only the formParameters field
    this.logger.info(
      { paramCount: Object.keys(record.formParameters ?? {}).length },
      'Form parameters retrieved',
    );
    return record.formParameters;
  }

  async validateTokenAndGetSavedJson(dto: ValidateTokenDto): Promise<any> {
    this.logger.info('Validating form access token');
    const token = dto.token;
    this.logger.debug('Passed token', token);
    this.logger.info('Checking whether form access token exists');

    let record;

    try {
      // Fetch the form params for this token
      record = await this.formParametersModel
        .findOne({ formAccessToken: { $eq: token } })
        .select({
          formParameters: 1,
          applicationFormId: 1,
          createdAt: 1,
          updatedAt: 1,
          _id: 0,
        })
        .lean()
        .exec();
    } catch (err) {
      // Log and handle only unexpected DB errors
      this.logger.error({ err }, 'Error validating token');
      throw new InternalServerErrorException('Failed to validate token');
    }
    // If not found, throw 404 error
    if (!record) {
      throw new NotFoundException(
        `No form parameters found for token ${token}`,
      );
    }

    this.logger.info('Succesfully found form access token');
    this.logger.info('Checking whether form access token is expired');

    // Check if createdAt is within the expiry time

    this.applicationFormService.assertTokenNotExpired(record.createdAt);

    this.logger.info('Form access token not expired, passing parameters');
    // Return only the formParameters field
    const applicationForm = await this.applicationFormModel
      .findOne({
        applicationFormId: record.applicationFormId,
      })
      .select({ formData: 1, _id: 0 }) // only needed fields
      .lean<ApplicationFormDocument>()
      .exec();
    if (!applicationForm) {
      throw new NotFoundException(`No application found for token ${token}`);
    }

    const formData = applicationForm.formData;

    if (formData != null) {
      this.logger.info(`Base64-encoded formData length: ${formData.length}`);
    } else this.logger.info(`Base64-encoded formData length: 0`);

    return { formJson: formData };
  }

  async getTombstoneDataByToken(
    formAccessToken: string,
  ): Promise<UserProfileResponse> {
    this.logger.info(
      { formAccessToken },
      'Fetching tombstone data by form access token',
    );

    try {
      // step 1: find the form parameter record with this token
      const formParameter = await this.formParametersModel
        .findOne({ formAccessToken: { $eq: formAccessToken } })
        .lean()
        .exec();

      if (!formParameter) {
        this.logger.warn({ formAccessToken }, 'Form access token not found');
        throw new NotFoundException('Form access token not found');
      }

      this.logger.debug(
        { formAccessToken, applicationFormId: formParameter.applicationFormId },
        'Found form parameter record',
      );

      // step 2: verify this is the most recent token for this application form
      const mostRecentToken = await this.formParametersModel
        .findOne({
          applicationFormId: { $eq: formParameter.applicationFormId },
        })
        .sort({ createdAt: -1 })
        .lean()
        .exec();

      if (!mostRecentToken) {
        this.logger.error(
          { applicationFormId: formParameter.applicationFormId },
          'No tokens found for application form (unexpected)',
        );
        throw new NotFoundException('No valid token found for this form');
      }

      this.applicationFormService.assertTokenNotExpired(
        formParameter.createdAt,
      );

      // check if the provided token matches the most recent one
      if (mostRecentToken.formAccessToken !== formAccessToken) {
        this.logger.warn(
          {
            providedToken: formAccessToken,
            mostRecentToken: mostRecentToken.formAccessToken,
            applicationFormId: formParameter.applicationFormId,
          },
          'Provided token is not the most recent for this application form',
        );
        throw new BadRequestException(
          'This token is not th emost recent token for the application form',
        );
      }
      this.logger.debug(
        { formAccessToken, applicationFormId: formParameter.applicationFormId },
        'Token verified as most recent',
      );

      // step 3: get the application form to find the userId
      const applicationForm = await this.applicationFormModel
        .findOne({
          applicationFormId: { $eq: formParameter.applicationFormId },
        })
        .lean()
        .exec();

      if (!applicationForm) {
        this.logger.error(
          { applicationFormId: formParameter.applicationFormId },
          'Application form not found',
        );
        throw new NotFoundException('Application form not found');
      }

      if (!applicationForm.userId) {
        this.logger.error(
          { applicationFormId: formParameter.applicationFormId },
          'Application form has no associated user',
        );
        throw new NotFoundException('No user associated with this form');
      }

      this.logger.debug(
        {
          applicationFormId: formParameter.applicationFormId,
          userId: applicationForm.userId,
        },
        'Found application form with user',
      );

      // step 4: get the user profile for tombstone data
      const user = await this.userService.findOne(applicationForm.userId);

      this.logger.info(
        {
          formAccessToken,
          userId: user.id,
        },
        'Successfully retrieved tombstone data by form access token',
      );

      // step 5: return tombstone data fields
      return {
        first_name: user.first_name,
        last_name: user.last_name,
        date_of_birth: user.dateOfBirth,
        street_address: user.street_address,
        city: user.city,
        region: user.region,
        postal_code: user.postal_code,
        email: user.email,
        home_phone: user.home_phone,
        alternate_phone: user.alternate_phone,
      };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      this.logger.error(
        {
          error,
          formAccessToken,
        },
        'Unexpected error getting tombstone data by token',
      );
      throw new InternalServerErrorException(
        'Failed to retrieve tombstone data',
      );
    }
  }
}
