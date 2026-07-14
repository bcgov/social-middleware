import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  AuthEventsService,
  UserLoggedInEvent,
} from '../../common/events/auth-events.service';
import {
  SiebelApiService,
  SiebelResourceCase,
  //SiebelSRResponse,
  SiebelSRsResponse,
} from '../../siebel/siebel-api.service';
import { ApplicationPackageService } from '../services/application-package.service';
import { ServiceRequestStage } from '../enums/application-package-status.enum';
import { UserService } from 'src/auth/user.service';
import { User } from '../../auth/schemas/user.schema';
import { ConfigService } from '@nestjs/config';
import { BcscSyncService } from '../services/bcsc-sync.service';

// private helper function to compute resouce case active date:
function resolveActiveCaseDate(c: SiebelResourceCase): Date {
  const reopened = c['Reopened Date'] ? new Date(c['Reopened Date']) : null;
  const created = c['Created Date'] ? new Date(c['Created Date']) : new Date(0);
  return reopened && reopened > created ? reopened : created;
}

@Injectable()
export class AuthListener implements OnModuleInit {
  constructor(
    private readonly authEventsService: AuthEventsService,
    private readonly siebelApiService: SiebelApiService,
    private readonly applicationPackageService: ApplicationPackageService,
    private readonly userService: UserService,
    private readonly bcscSyncService: BcscSyncService,
    private readonly configService: ConfigService,
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

      // sync resource case status (requires contact_id to be est)
      if (this.configService.get<string>('TEST_RESOURCE_CASE') === 'true') {
        await this.syncResourceCase(userData);
      }

      // remove any previously withdrawn application packages
      await this.applicationPackageService.deleteWithdrawnPackages(
        userData.userId,
      );

      //if the BCSC Data has changed, we need to do some checks
      if (userData.bcscDataChanged) {
        this.logger.info(
          { userId: userData.userId },
          'BCSC data changed — running package sync',
        );
        await this.bcscSyncService.syncOnLogin(userData.userId);
      }

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

      if (!result?.Id) {
        this.logger.info(
          { userId: userData.userId },
          'No ICM contact found - contact_id not set',
        );
        return;
      }

      await this.userService.updateUser(userData.userId, {
        contact_id: result.Id,
      });
      this.logger.info(
        { userId: userData.userId, contactId: result.Id },
        'ICM contact_id persisted to user record',
      );
    } catch (error) {
      this.logger.error(
        { error, userId: userData.userId },
        'Failed to sync ICM contact_id - login not blocked',
      );
    }
  }

  private async syncResourceCase(userData: UserLoggedInEvent): Promise<void> {
    try {
      const user = await this.userService.findOne(userData.userId);
      if (!user.contact_id) {
        return;
      }

      // to prevent too much traffic we're only going to check resource cases once a day
      const todayUtc = new Date();
      todayUtc.setUTCHours(0, 0, 0, 0);
      if (
        user.resource_case_last_checked &&
        new Date(user.resource_case_last_checked) >= todayUtc
      ) {
        this.logger.debug(
          { userId: userData.userId },
          'Resource case already checked today — skipping',
        );
        return;
      }

      const openCases =
        await this.siebelApiService.getOpenResourceCasesByContactId(
          user.contact_id,
        );

      const updateFields: Partial<User> = {
        resource_case_last_checked: new Date(),
      };

      // they say that there will only be one active resource case per contact
      // however that may not be true, particularly in the test environments
      if (openCases.length > 0) {
        if (openCases.length > 1) {
          this.logger.warn(
            {
              userId: userData.userId,
              contactId: user.contact_id,
              count: openCases.length,
            },
            'Multiple open resource cases found -- using most recent',
          );
        }
        // use the latest if there are more than 1
        const latest = openCases.reduce((best, c) =>
          resolveActiveCaseDate(c) > resolveActiveCaseDate(best) ? c : best,
        );

        updateFields.resource_case_id = latest.Id;
        updateFields.resource_case_active_date = resolveActiveCaseDate(latest);
        updateFields.resource_case_closed = false;

        this.logger.info(
          { userId: userData.userId, caseId: latest.Id },
          'Resource case synced',
        );
      } else if (user.resource_case_id) {
        updateFields.resource_case_closed = true;
        this.logger.info(
          { userId: userData.userId, caseId: user.resource_case_id },
          'Resource case closed - no open cases found in ICM',
        );
      }

      await this.userService.updateUser(userData.userId, updateFields);
    } catch (error) {
      this.logger.error(
        { error, userId: userData.userId },
        'Failed to sync resource case - login not blocked',
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
