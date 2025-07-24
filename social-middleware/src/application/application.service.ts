import {
  Injectable,
  InternalServerErrorException,
  BadRequestException,
  UnauthorizedException,
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

@Injectable()
export class ApplicationService {
  constructor(
    @InjectModel(Application.name)
    private applicationModel: Model<ApplicationDocument>,
    @InjectModel(FormParameters.name)
    private formParametersModel: Model<FormParametersDocument>,
    @InjectPinoLogger(ApplicationService.name)
    private readonly logger: PinoLogger,
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
        { applicationId, primary_applicantId: userId, formId: dto.formId},
        "Generated UUIDS",
      );

      const application = new this.applicationModel({
        applicationId,
        primary_applicantId: userId,
        formData: dto.formData ?? null,
      });

      await application.save();
      this.logger.info({ applicationId }, 'Saved application to DB');

      const formParameters = new this.formParametersModel({
        applicationId,
        type: FormType.New,
        formId: dto.formId,
        formAccessToken,
        formParameters: dto.formParameters,
      });

      await formParameters.save();
      this.logger.info({ formAccessToken }, 'Saved form parameters to DB');

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
}
