import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { v4 as uuidv4 } from 'uuid';
import { Model } from 'mongoose';
import { Application, ApplicationDocument } from './schemas/application.schema';
import { FormParameters, FormParametersDocument } from './schemas/form-parameters.schema';
import { CreateApplicationDto } from './dto/create-application.dto';
import { FormType } from './enums/form-type.enum';

@Injectable()
export class ApplicationService {
    constructor(
        @InjectModel(Application.name)
        private applicationModel: Model<ApplicationDocument>,
        @InjectModel(FormParameters.name)
        private formParametersModel: Model<FormParametersDocument>,
        @InjectPinoLogger(ApplicationService.name)
        private readonly logger: PinoLogger,
    ) { }

    async createApplication(dto: CreateApplicationDto): Promise<{ formAccessToken: string }> {
        const applicationId = uuidv4();
        const formAccessToken = uuidv4();

        try {
            this.logger.info('Creating new application');
            this.logger.debug({ applicationId, userId: dto.user.id, formId: dto.formId }, 'Generated UUIDs');

            const application = new this.applicationModel({
                applicationId,
                userId: dto.user.id,
                formData: null,
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
                this.logger.error({ error }, 'Unknown error during application creation');
            }
            throw new InternalServerErrorException('Failed to create application');
        }
    }
}
