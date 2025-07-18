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

@Injectable()
export class FormsService {
  constructor(
    private readonly configService: ConfigService,
    @InjectModel(FormParameters.name)
    private formParametersModel: Model<FormParametersDocument>,
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
    return record.formParameters;
  }
}
