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
import { SiebelApiService } from '../../siebel/siebel-api.service';
import {
  ApplicationPackage,
  ApplicationPackageDocument,
} from '../schema/application-package.schema';
import { ApplicationPackageService } from '../application-package.service';
import { ServiceRequestStage } from '../enums/application-package-status.enum';

interface ServiceRequestItem {
  Id: string;
  'ICM Stage'?: string;
  [key: string]: unknown;
}

interface ServiceRequestResponse {
  items?: ServiceRequestItem | ServiceRequestItem[];
}

/* We will periodically check ICM for service requests we know about to see if they have changed stages
 * or other key pieces of information.
 */

@Injectable()
@Processor('icmStageQueue')
export class IcmStageProcessor {
  constructor(
    @InjectModel(ApplicationPackage.name)
    private readonly applicationPackageModel: Model<ApplicationPackageDocument>,
    private readonly applicationPackageService: ApplicationPackageService,
    private readonly siebelApiService: SiebelApiService,
    @InjectPinoLogger(IcmStageProcessor.name)
    private readonly logger: PinoLogger,
  ) {}
  @Process('check-icm-stage')
  async handleStageCheck(job: Job): Promise<{ checked: number }> {
    this.logger.info({ jobId: job.id }, 'Processing ICM stage check');

    try {
      // Find all application packages with srId; they have been submitted to ICM
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

      // Get all srIds in a map for easy access
      const srIds = packages.map((pkg) => pkg.srId).filter(Boolean);

      // chunk into groups of 10 because we need to do our ICM requests using 'OR' statements; more than 10 will be too heavy.
      const chunkSize = 10;
      const chunks: string[][] = [];

      for (let i = 0; i < srIds.length; i += chunkSize) {
        chunks.push(srIds.slice(i, i + chunkSize));
      }

      this.logger.info(
        { totalSrIds: srIds.length, chunks: chunks.length },
        'Chunked srIds for ICM calls',
      );

      // collection for all service requests from ICM so we can read through them
      const allStages: ServiceRequestItem[] = [];

      // process each chunk
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        // build a searchSpec with OR conditions for entire chunk
        const searchSpec =
          '(' + chunk.map((srId) => `[Id]='${srId}'`).join(' OR ') + ')';

        this.logger.info(
          { chunkIndex: i + 1, totalChunks: chunks.length, searchSpec },
          'Processing chunk',
        );

        try {
          // get the service requests for the chunk/searchSpec
          const rawResponse = await this.siebelApiService.getServiceRequests({
            searchspec: searchSpec,
            ViewMode: 'Organization',
            fields: 'Id, Type, SR Sub Type, SR Sub Sub Type, ICM Stage, Status',
            PageSize: 20,
          });

          const response = rawResponse as ServiceRequestResponse;

          // response may be an array of items, may empty..
          const items: ServiceRequestItem[] = response?.items
            ? Array.isArray(response.items)
              ? response.items
              : [response.items]
            : [];

          // push the array of items to the collection of all stages to analyze
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

      // now let's check allStages vs packages for differences and call our updateApplicationPackageStage()
      // create a map of srId -> service request for quick lookup
      const srMap = new Map(allStages.map((sr) => [sr.Id, sr]));

      // keep track of how many we've updated..
      let stagesUpdated = 0;

      // loop through packages and check for stage differences
      for (const pkg of packages) {
        const sr = srMap.get(pkg.srId);

        // basic error checking; should not happen unless we constructed our searchSpec wrong..
        if (!sr) {
          this.logger.warn(
            { srId: pkg.srId, packageId: pkg._id },
            'Service request not found in ICM response',
          );
          continue;
        }

        const icmStage = sr['ICM Stage'] as ServiceRequestStage;

        // again, should not happen unless the service runs at the exact moment a service request is being created by the portal
        if (!icmStage) {
          this.logger.warn({ srId: pkg.srId }, 'No ICM stage in response');
          continue;
        }

        // check if the stage has changed
        if (pkg.srStage !== icmStage) {
          this.logger.info(
            {
              srId: pkg.srId,
              packageId: pkg._id,
              oldStage: pkg.srStage,
              newStage: icmStage,
            },
            'Stage change detected - updating',
          );

          try {
            // updateApplicationPackageStage handles the business logic of the stage change
            // it may also enqueue notification messages
            await this.applicationPackageService.updateApplicationPackageStage(
              pkg as ApplicationPackage,
              icmStage,
            );
            stagesUpdated++;
          } catch (error) {
            this.logger.error(
              {
                error,
                srId: pkg.srId,
                packageId: pkg._id,
              },
              'Failed to update application package stage',
            );
          }
        }
      }

      this.logger.info(
        { totalChecked: packages.length, stagesUpdated },
        'ICM stage check complete',
      );
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
