import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  AuthEventsService,
  UserLoggedInEvent,
} from '../../common/events/auth-events.service';
import {
  SiebelApiService,
  SiebelSRResponse,
} from '../../siebel/siebel-api.service';
import { ApplicationPackageService } from '../application-package.service';

@Injectable()
export class AuthListener implements OnModuleInit {
  constructor(
    private readonly authEventsService: AuthEventsService,
    private readonly siebelApiService: SiebelApiService,
    private readonly applicationPackageService: ApplicationPackageService,
    @InjectPinoLogger(AuthListener.name)
    private readonly logger: PinoLogger,
  ) {}

  onModuleInit() {
    this.authEventsService.onUserLoggedIn((userData) => {
      this.handleUserLogin(userData).catch(() => {
        this.logger.error(
          { userId: userData.userId },
          'Error in user login event handler',
        );
      });
    });
    this.logger.info(
      'AuthListener initialized and listening for user login events',
    );
  }

  private async handleUserLogin(userData: UserLoggedInEvent) {
    try {
      this.logger.info(`Handling user login for userId: ${userData.userId}`);

      // get service requests from Siebel

      const serviceRequests: SiebelSRResponse[] | null =
        await this.siebelApiService.getServiceRequestsByBcscId(
          userData.bc_services_card_id,
        );

      this.logger.info(
        `Fetched ${serviceRequests?.length} service requests for userId: ${userData.userId}`,
      );
      if (serviceRequests && serviceRequests.length === 0) {
        await this.syncUserApplicationPackages(userData, serviceRequests);
      }
    } catch (error) {
      this.logger.error(
        {
          error,
          userId: userData.userId,
          bc_services_card_id: userData.bc_services_card_id,
        },
        'Error handling user login event',
      );
    }
  }

  private async syncUserApplicationPackages(
    userData: UserLoggedInEvent,
    serviceRequests: SiebelSRResponse[],
  ) {
    // get all existing application packages for the user
    const applicationPackages =
      await this.applicationPackageService.getApplicationPackages(
        userData.userId,
      );

    // loop through service requests to see what's found in applicationPackages;
    // we will update ones that exist, and potentially create new ones otherwise;
    // creating new ones is required for OOC type applications and screening activities.

    try {
      for (const sr of serviceRequests) {
        const srId = sr.Id as string;
        const srStage = sr['ICM Stage'] as string;
        this.logger.info(
          `Syncing application package for service request ID: ${srId}, stage: ${srStage}`,
        );
        // see if we have an application package for this service request already
        const existingPackage = applicationPackages.find(
          (app) => app.srId === srId,
        );

        if (existingPackage) {
          this.logger.info(
            `Application package found for service request ID: ${srId}, synching stage if needed`,
          );
          // update the stage if it has changed

          if (existingPackage.srStage !== srStage) {
            this.logger.info(
              `Updating application package stage for service request ID: ${srId} from ${existingPackage.srStage} to ${srStage}`,
            );
            existingPackage.srStage = srStage;
            existingPackage.updatedAt = new Date();
            continue;
          }
        } else {
          this.logger.info(
            `No application package found for service request ID: ${srId}, creating new package`,
          );
          continue;
        }
      }
    } catch (error) {
      this.logger.error(
        { error, userId: userData.userId },
        'Error syncing application package for service request',
      );
      throw error;
    }
  }
}
