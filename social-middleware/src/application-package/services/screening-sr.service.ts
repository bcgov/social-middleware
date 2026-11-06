import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Model } from 'mongoose';
import { User } from '../../auth/schemas/user.schema';
import { UserService } from '../../auth/user.service';
import { RelationshipToPrimary } from '../../household/enums/relationship-to-primary.enum';
import { HouseholdMembersDocument } from '../../household/schemas/household-members.schema';
import { HouseholdService } from '../../household/services/household.service';
import { ResourceCaseService } from '../../resource-case/resource-case.service';
import { SiebelApiService } from '../../siebel/siebel-api.service';
import { ApplicationPackage } from '../schema/application-package.schema';

export interface ScreeningSubject {
  member: HouseholdMembersDocument;
  user: User;
}

/**
 * Caregiver Screening service requests: an SR that belongs to one person being screened
 * (an additional adult, later a relief provider). That person is the SR's only prospect and their
 * BCSC DID is on the SR. The SR is linked to the primary applicant's resource case, and is created
 * only at submission.
 */

@Injectable()
export class ScreeningSrService {
  constructor(
    @InjectModel(ApplicationPackage.name)
    private readonly applicationPackageModel: Model<ApplicationPackage>,
    private readonly householdService: HouseholdService,
    private readonly userService: UserService,
    private readonly resourceCaseService: ResourceCaseService,
    private readonly siebelApiService: SiebelApiService,
    private readonly configService: ConfigService,
    @InjectPinoLogger(ScreeningSrService.name)
    private readonly logger: PinoLogger,
  ) {}

  /** The one person a screening package is about: the non-Self member, who has signed in with their BC Services Card. */
  async resolveSubject(
    applicationPackageId: string,
  ): Promise<ScreeningSubject> {
    const members =
      await this.householdService.findAllHouseholdMembers(applicationPackageId);
    const subjects = members.filter(
      (m) => m.relationshipToPrimary !== RelationshipToPrimary.Self,
    );
    if (subjects.length !== 1) {
      throw new InternalServerErrorException(
        `Screening package ${applicationPackageId} should have exactly one member being screened, found ${subjects.length}`,
      );
    }
    const member = subjects[0];
    if (!member.userId) {
      throw new UnprocessableEntityException(
        'The person being screened has not redeemed their access code',
      );
    }
    const user = await this.userService.findOne(member.userId);
    if (!user?.bc_services_card_id) {
      throw new UnprocessableEntityException(
        'The person being screened has no BC Services Card identity',
      );
    }
    return { member, user };
  }

  /**
   * Make sure the package has a Caregiver Screening SR linked to the primary applicant's resource case.
   * Safe to repeat: each stage is skipped if it is already done, and the srId is saved as soon as it exists.
   */
  async ensureScreeningSr(
    applicationPackageId: string,
  ): Promise<{ srId: string; subject: ScreeningSubject }> {
    const pkg = await this.applicationPackageModel
      .findOne({ applicationPackageId })
      .exec();
    if (!pkg?.userId) {
      throw new NotFoundException('Application package not found');
    }
    const subject = await this.resolveSubject(applicationPackageId);
    const icmCase = await this.resourceCaseService.getOpenCaseForUser(
      pkg.userId,
    );
    if (!icmCase.officeName) {
      throw new UnprocessableEntityException(
        'The resource case has no local office',
      );
    }
    let srId = pkg.srId;
    if (!srId) {
      srId = await this.createScreeningSr(
        subject.user.bc_services_card_id,
        icmCase.officeName,
      );
      // save immediately so a retry never creates a second SR
      await this.applicationPackageModel.updateOne(
        { applicationPackageId },
        { srId },
      );
      this.logger.info(
        { applicationPackageId, srId },
        'Caregiver Screening service request created',
      );
    }
    const linkedCaseIds =
      await this.siebelApiService.getServiceRequestCaseIds(srId);
    if (!linkedCaseIds.includes(icmCase.caseId)) {
      await this.siebelApiService.linkServiceRequestToCase(
        srId,
        icmCase.caseId,
      );
      this.logger.info(
        { applicationPackageId, srId, caseId: icmCase.caseId },
        'Caregiver Screening service request linked to resource case',
      );
    }
    return { srId, subject };
  }

  private async createScreeningSr(
    bcscDid: string,
    serviceOffice: string,
  ): Promise<string> {
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
    const envSuffix = nodeEnv.toLowerCase().includes('prod') ? '' : nodeEnv;

    const response = (await this.siebelApiService.createServiceRequest({
      Id: 'NULL',
      Status: 'Open',
      Priority: '3-Standard',
      Type: 'Caregiver Screening',
      'ICM BCSC DID': bcscDid,
      'Service Office': serviceOffice,
      'Comm Method': 'Client Portal',
      Memo: `Created By ${envSuffix} Portal`,
    })) as { items?: { Id?: string } } | undefined;
    const srId = response?.items?.Id;
    if (!srId) {
      this.logger.error({ response }, 'No service request ID in response');
      throw new InternalServerErrorException(
        'Failed to get service request ID from Siebel',
      );
    }
    return srId;
  }
}
