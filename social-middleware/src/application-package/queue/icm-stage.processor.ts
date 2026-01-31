import {
  Processor,
  Process,
  OnQueueCompleted,
  OnQueueFailed,
} from '@nestjs/bull';
import { Job } from 'bull';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { SiebelApiService } from '../../siebel/siebel-api.service';
import {
  ApplicationPackage,
  ApplicationPackageDocument,
} from '../schema/application-package.schema';

interface ServiceRequestItem {
  Id: string;
  Stage?: string;
  [key: string]: any;
}

interface ServiceRequestResponse {
  items?: ServiceRequestItem | ServiceRequestItem[];
}

@Injectable()
@Processor('icmStageQueue')
export class IcmStageProcessor {
  constructor(
    @InjectModel(ApplicationPackage.name)
    private readonly applicationPackageModel: Model<ApplicationPackageDocument>,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly siebelApiService: SiebelApiService,
    @InjectPinoLogger(IcmStageProcessor.name)
    private readonly logger: PinoLogger,
  ) {}
  @Process('check-icm-stage')
  async handleStageCheck(job: Job): Promise<{ checked: number }> {
    this.logger.info('Processing ICM stage check');

    try {
      // Find all application packages with srId
      const packages = await this.applicationPackageModel
        .find({
          srId: { $exists: true, $ne: null },
        })
        .lean()
        .exec();

      this.logger.info(
        { count: packages.length },
        'Found packages with service requests',
      );

      if (packages.length === 0) {
        return { checked: 0 };
      }

      // Get all srIds
      const srIds = packages.map((pkg) => pkg.srId).filter(Boolean);

      // chunk into groups of 10
      const chunkSize = 10;
      const chunks: string[][] = [];

      for (let i = 0; i < srIds.length; i += chunkSize) {
        chunks.push(srIds.slice(i, i + chunkSize));
      }

      this.logger.info(
        { totalSrIds: srIds.length, chunks: chunks.length },
        'Chunked srIds for ICM calls',
      );

      const allStages: ServiceRequestItem[] = [];

      // process each chunk

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        // build SearchSpec with OR conditions
        const searchSpec =
          '(' + chunk.map((srId) => `[Id]='${srId}'`).join(' OR ') + ')';

        this.logger.info(
          { chunkIndex: i + 1, totalChunks: chunks.length, searchSpec },
          'Processing chunk',
        );

        try {
          const rawResponse = await this.siebelApiService.getServiceRequests({
            searchspec: searchSpec,
            ViewMode: 'Organization',
            fields: 'Id, Type, SR Sub Type, SR Sub Sub Type, ICM Stage, Status',
            PageSize: 20,
          });

          const response = rawResponse as ServiceRequestResponse;

          const items: ServiceRequestItem[] = response?.items
            ? Array.isArray(response.items)
              ? response.items
              : [response.items]
            : [];

          allStages.push(...items);

          this.logger.info(
            { chunkIndex: i + 1, itemsReceived: items.length },
            'Chunk processed successfully',
          );
        } catch (error) {
          this.logger.error(
            {
              error,
              chunkIndex: i + 1,
              chunk,
            },
            'Error processing chunk',
          );
        }
      }

      this.logger.info(
        { totalStages: allStages.length },
        'All stages retrieved',
      );

      //const response = await firstValueFrom();

      //const icmStages = response.data;

      //this.logger.info({ icmStages }, 'Received ICM stages');

      // TODO: Process the statuses (compare, send notifications, etc.)

      return { checked: packages.length };
    } catch (error) {
      this.logger.error({ error }, 'Error during ICM stage check');
      throw error;
    }
  }

  @OnQueueCompleted()
  onCompleted(job: Job, result: unknown) {
    this.logger.info({ jobId: job.id, result }, 'ICM stage check completed');
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(
      { jobId: job.id, error: error.message },
      'ICM status check failed',
    );
  }
}
