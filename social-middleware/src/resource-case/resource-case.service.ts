import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  HttpException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { UserService } from '../auth/user.service';
import { User } from '../auth/schemas/user.schema';
import { SiebelApiService } from '../siebel/siebel-api.service';
import { assertWithinCaseWindow } from '../common/utils/case-window.util';
import { NOT_MANAGEABLE_RELATIONSHIPS } from '../siebel/enums/icm-case-contact-relationship.enum';
import { randomUUID } from 'crypto';
import { HouseholdContactService } from './household-contact.service';

export interface OpenResourceCase {
  user: User;
  caseId: string;
  caseNumber?: string;
  assigneeId: string; // ICM 'Assigned To Id'
  assignee: string; // ICM 'Assigned To' (trusted username for the activity)
}

// must exceed the Siebel request timeout, so a live claim is never treated as stale
const REMOVAL_CLAIM_TTL_MS = 2 * 60 * 1000;

@Injectable()
export class ResourceCaseService {
  constructor(
    private readonly userService: UserService,
    private readonly householdContactService: HouseholdContactService,
    private readonly siebelApiService: SiebelApiService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ResourceCaseService.name);
  }

  private async getCaseUser(userId: string): Promise<User> {
    const user = await this.userService.findOne(userId);
    if (
      !user.resource_case_id ||
      user.resource_case_closed ||
      !user.contact_id
    ) {
      throw new ForbiddenException('No open resource case');
    }
    return user;
  }

  async resolveIcmCase(user: User): Promise<Omit<OpenResourceCase, 'user'>> {
    if (!user.contact_id) throw new ForbiddenException('No open resource case');
    const openCases =
      await this.siebelApiService.getOpenResourceCasesByContactId(
        user.contact_id,
      );
    const icmCase = openCases.find((c) => c.Id === user.resource_case_id);
    if (!icmCase) throw new ForbiddenException('No open resource case');

    const assigneeId = icmCase['Assigned To Id'];
    if (!assigneeId) {
      throw new UnprocessableEntityException(
        'No social worker is assigned to the resource case',
      );
    }
    return {
      caseId: icmCase.Id,
      caseNumber: icmCase['Case Num'],
      assigneeId,
      assignee: icmCase['Assigned To'],
    };
  }

  async getOpenCaseForUser(userId: string): Promise<OpenResourceCase> {
    const user = await this.getCaseUser(userId);
    return { user, ...(await this.resolveIcmCase(user)) };
  }

  async listHouseholdContacts(userId: string) {
    const user = await this.userService.findOne(userId);
    if (!user.resource_case_id || user.resource_case_closed) return [];
    const today = new Date().toLocaleDateString('en-CA');
    return this.householdContactService.listActiveForCase(
      user.resource_case_id,
      today,
    );
  }

  async requestHouseholdMemberRemoval(
    userId: string,
    caseContactId: string,
    departureDate: string,
  ): Promise<void> {
    const user = await this.getCaseUser(userId); // cheap checks first, no ICM yet
    const caseId = user.resource_case_id!;

    const contact = await this.householdContactService.findOneForCase(
      caseId,
      caseContactId,
    );
    if (!contact) throw new NotFoundException('Household member not found');

    if (NOT_MANAGEABLE_RELATIONSHIPS.includes(contact.relationship)) {
      throw new ForbiddenException('This member cannot be removed here');
    }

    if (contact.removal_requested) {
      // a repeat of the same request is a success, not an error
      if (contact.removal_departure_date === departureDate) return;
      throw new ConflictException('Removal already requested');
    }
    assertWithinCaseWindow(
      departureDate,
      user.resource_case_active_date,
      'Date of departure',
    );

    const claimId = randomUUID();
    const claimed = await this.householdContactService.claimRemoval(
      caseId,
      caseContactId,
      claimId,
      new Date(Date.now() - REMOVAL_CLAIM_TTL_MS),
    );
    if (!claimed) {
      // another request holds the claim or just finished; a retry resolves to 204 or 409
      throw new ConflictException('Removal already in progress');
    }

    try {
      const icm = await this.resolveIcmCase(user);
      await this.siebelApiService.createHouseholdRemovalNotification(
        icm.caseId,
        {
          owner: icm.assigneeId,
          assignedTo: icm.assignee,
          caseNumber: icm.caseNumber,
          memberName: `${contact.first_name} ${contact.last_name}`,
          departureDate,
        },
      );
    } catch (error) {
      await this.householdContactService
        .releaseRemoval(caseId, caseContactId, claimId)
        .catch((e: unknown) =>
          this.logger.error(
            { e, userId, caseContactId },
            'Failed to release removal claim',
          ),
        );

      if (error instanceof HttpException) throw error; // 403 / 422 from resolveIcmCase
      this.logger.error(
        { error, userId, caseContactId },
        'Failed to create household removal notification in ICM',
      );
      throw new BadGatewayException(
        'Could not notify the social worker. Please try again later.',
      );
    }

    const completed = await this.householdContactService.completeRemoval(
      caseId,
      caseContactId,
      claimId,
      departureDate,
    );
    if (!completed) {
      // our claim went stale and was taken over; ICM already has the activity
      this.logger.warn(
        { caseId, caseContactId, claimId },
        'Removal claim lost before completion',
      );
    }

    this.logger.info(
      { caseId, caseContactId, departureDate },
      'Household member removal requested',
    );
  }
}
