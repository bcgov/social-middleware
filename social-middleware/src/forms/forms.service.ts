import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ValidateTokenDto } from './dto/validate-token.dto';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import {
  FormParameters,
  FormParametersDocument,
} from 'src/application/schemas/form-parameters.schema';
import { Model } from 'mongoose';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ApplicationService } from 'src/application/application.service';
import {
  Application,
  ApplicationDocument,
} from 'src/application/schemas/application.schema';

@Injectable()
export class FormsService {
  constructor(
    private readonly configService: ConfigService,
    @InjectModel(FormParameters.name)
    private formParametersModel: Model<FormParametersDocument>,
    @InjectModel(Application.name)
    private applicationModel: Model<Model<ApplicationDocument>>,
    @InjectPinoLogger(ApplicationService.name)
    private readonly logger: PinoLogger,
  ) {}
  async validateTokenAndGetParameters(dto: ValidateTokenDto): Promise<any> {
    this.logger.info('Validating form access token');
    const token = dto.token;
    this.logger.debug('Passed token', token);
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
      this.logger.error('Error validating token', err);
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
    this.logger.info('Form access token not expired, passing parameters');
    // Return only the formParameters field
    this.logger.info('Form Parameters', record.formParameters);
    return record.formParameters;
  }
  async validateTokenAndGetSavedJson(dto: ValidateTokenDto): Promise<any> {
    this.logger.info('Validating form access token');
    const token = dto.token;
    this.logger.debug('Passed token', token);
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
        .select({
          formParameters: 1,
          applicationId: 1,
          createdAt: 1,
          updatedAt: 1,
          _id: 0,
        })
        .lean()
        .exec();
    } catch (err) {
      // Log and handle only unexpected DB errors
      this.logger.error('Error validating token', err);
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
      console.log('Token expired, but continue for now'); //TODO remove this for the real case
      //throw new BadRequestException('Token has expired');
    }
    this.logger.info('Form access token not expired, passing parameters');
    // Return only the formParameters field
    const application = await this.applicationModel
      .findOne({
        applicationId: record.applicationId,
      })
      .select({ formData: 1, _id: 0 }) // only needed fields
      .lean<ApplicationDocument>()
      .exec();
    if (!application) {
      throw new NotFoundException(`No application found for token ${token}`);
    }
    // Convert JSON to string
    const json = application.formData
      ? JSON.stringify(application.formData)
      : '{}';

    // Encode to base64 using Node.js Buffer
    const base64 = Buffer.from(json, 'utf8').toString('base64'); // ✅ standard Node.js approach :contentReference[oaicite:1]{index=1}

    this.logger.info(`Base64-encoded formData length: ${base64.length}`);

    // Return the base64 string (in an object or as-is)
    return { form: base64 };
  }
}
