import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  AuthEventsService,
  UserLoggedInEvent,
} from '../../common/events/auth-events.service';
import {
  SiebelApiService,
  //SiebelSRResponse,
  SiebelSRsResponse,
} from '../../siebel/siebel-api.service';
import { ApplicationPackageService } from '../application-package.service';
import { ServiceRequestStage } from '../enums/application-package-status.enum';
import { UserService } from 'src/auth/user.service';

@Injectable()
export class AuthListener implements OnModuleInit {
  constructor(
    private readonly authEventsService: AuthEventsService,
    private readonly siebelApiService: SiebelApiService,
    private readonly applicationPackageService: ApplicationPackageService,
    private readonly userService: UserService,
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

      // sync the ICM Contact ID (if available)
      await this.syncContactId(userData);

      // get service requests from Siebel

      const serviceRequests: SiebelSRsResponse =
        await this.siebelApiService.getServiceRequestsByBcscId(
          userData.bc_services_card_id,
        );

      this.logger.debug(`Service Requests: ${JSON.stringify(serviceRequests)}`);

      this.logger.info(
        `Fetched ${serviceRequests?.items?.length || 0} service requests for userId: ${userData.userId}`,
      );

      if (serviceRequests && (serviceRequests.items?.length || 0) > 0) {
        await this.syncUserApplicationPackages(userData, serviceRequests);
      }
      this.authEventsService.completeUserSync(userData.userId);
    } catch (error) {
      this.logger.error(
        {
          error,
          userId: userData.userId,
          bc_services_card_id: userData.bc_services_card_id,
        },
        'Error handling user login event',
      );
      this.authEventsService.completeUserSync(userData.userId);
    }
  }

  private async syncContactId(userData: UserLoggedInEvent): Promise<void> {
    try {
      const user = await this.userService.findOne(userData.userId);
      if (user.contact_id) {
        return;
      }

      this.logger.info(
        { userId: userData.userId },
        'contact_id not set — attempting ICM contact lookup',
      );
      const result = await this.siebelApiService.getContactByBcscId(
        userData.bc_services_card_id,
      );

      if (!result?.items) {
        this.logger.info(
          { userId: userData.userId },
          'No ICM contact found - contact_id not set',
        );
        return;
      }

      const items = Array.isArray(result.items) ? result.items : [result.items];
      const contactId = items[0]?.Id;
      if (!contactId) {
        this.logger.warn(
          { userId: userData.userId },
          'ICM contact returned but Id field is missing',
        );
        return;
      }

      await this.userService.updateUser(userData.userId, {
        contact_id: contactId,
      });
      this.logger.info(
        {
          userId: userData.userId,
          contactId,
        },
        'ICM contact_id persisted to user record',
      );
    } catch (error) {
      this.logger.error(
        { error, userId: userData.userId },
        'Failed to sync ICM contact_id - login not blocked',
      );
    }
  }

  private async syncUserApplicationPackages(
    userData: UserLoggedInEvent,
    serviceRequestsResponse: SiebelSRsResponse,
  ) {
    // get all existing application packages for the user
    const applicationPackages =
      await this.applicationPackageService.getApplicationPackages(
        userData.userId,
      );

    //this.logger.info(
    //  `Syncing application packages for userId: ${userData.userId}, found ${applicationPackages.length} existing packages`,
    //);

    // loop through service requests to see what's found in applicationPackages;
    // we will update ones that exist, and potentially create new ones otherwise;
    // creating new ones is required for OOC type applications and screening activities.

    try {
      const serviceRequests = serviceRequestsResponse.items ?? [];

      for (const sr of serviceRequests) {
        const srId = sr.Id as string;
        const srStage = sr['ICM Stage'] as ServiceRequestStage;

        //        this.logger.info(`ID: ${srId}`);
        //        this.logger.info(`ICM Stage value: "${srStage}"`);
        //        this.logger.info(`ICM Stage type: ${typeof srStage}`);

        const existingPackage = applicationPackages.find(
          (app) => app.srId === srId,
        );

        if (existingPackage) {
          this.logger.info(
            `Application package found for srId: ${srId} srStage:${srStage}, applicationPackage stage: ${existingPackage.srStage}`,
          );
          // update the stage if it has changed

          if (existingPackage.srStage !== srStage) {
            this.logger.info(
              `Updating application package stage for service request ID: ${srId} from ${existingPackage.srStage} to ${srStage}`,
            );
            await this.applicationPackageService.updateApplicationPackageStage(
              existingPackage,
              srStage,
            );
            continue;
          }
        } else {
          //this.logger.info(
          //  `No application package found for service request ID: ${srId}`,
          //);
          continue;
        }
      }
    } catch (error: unknown) {
      this.logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          userId: userData.userId,
        },
        'Error syncing application package for service request',
      );
      throw error;
    }
  }
}
