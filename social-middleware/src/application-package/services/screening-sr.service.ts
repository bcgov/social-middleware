import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  HttpException,
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
import { ApplicationFormService } from '../../application-form/services/application-form.service';
import { AttachmentsService } from '../../attachments/attachments.service';
import { ApplicationPackageStatus } from '../enums/application-package-status.enum';
import { ProspectService } from './prospect.service';
import { SrAttachmentService } from './sr-attachment.service';
import { ApplicationPackageSubType } from '../enums/application-package-subtypes.enum';

export interface ScreeningSubject {
  member: HouseholdMembersDocument;
  user: User | null; // null when the person never signed in (the primary uploaded their forms)
}

// Screening subtypes where the person does not have to sign in with their BC Services Card: the primary
// applicant may complete the screening for them by uploading signed forms. Any subtype not listed here
// requires sign-in (a Relief Provider must, because ICM deals with them afterwards).
const SIGN_IN_OPTIONAL_SUBTYPES: readonly string[] = [
  ApplicationPackageSubType.ADDITIONAL_ADULT,
];

// A submission failure that retrying cannot fix. The submission job marks the package FAILED immediately.
export class NonRetryableSubmissionError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'NonRetryableSubmissionError';
  }
}

/**
 * Caregiver Screening service requests: an SR that belongs to one person being screened
 * (an additional adult, later a relief provider). That person is the SR's only prospect and their
 * BCSC DID is on the SR when they have signed in. The SR is linked to the primary applicant's resource case, and is created
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
    private readonly prospectService: ProspectService,
    private readonly applicationFormService: ApplicationFormService,
    private readonly srAttachmentService: SrAttachmentService,
    private readonly attachmentsService: AttachmentsService,
    @InjectPinoLogger(ScreeningSrService.name)
    private readonly logger: PinoLogger,
  ) {}

  /**
   * The one person a screening package is about: the non-Self member.
   * They have signed in with their BC Services Card unless the subtype allows the primary applicant
   * to complete the screening for them, in which case user is null.
   */
  async resolveSubject(
    applicationPackageId: string,
    signInRequired: boolean,
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
      if (signInRequired) {
        throw new UnprocessableEntityException(
          'The person being screened has not redeemed their access code',
        );
      }
      return { member, user: null };
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
  async ensureScreeningSr(applicationPackageId: string): Promise<{
    srId: string;
    subject: ScreeningSubject;
    ownerUserId: string;
  }> {
    const pkg = await this.applicationPackageModel
      .findOne({ applicationPackageId })
      .exec();
    if (!pkg?.userId) {
      throw new NotFoundException('Application package not found');
    }
    const signInRequired = !SIGN_IN_OPTIONAL_SUBTYPES.includes(pkg.subtype);
    const subject = await this.resolveSubject(
      applicationPackageId,
      signInRequired,
    );
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
        subject.user?.bc_services_card_id,
        icmCase.officeName,
        icmCase.assignee,
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
    return { srId, subject, ownerUserId: pkg.userId };
  }

  /**
   * Submit a READY screening package to ICM: SR, case link, the screened person's prospect, then their forms.
   * Each stage is skipped if already done, so a retry resumes where it stopped.
   * Throws NonRetryableSubmissionError for failures a retry cannot fix.
   */
  async submitScreening(
    applicationPackageId: string,
  ): Promise<{ serviceRequestId: string }> {
    try {
      return await this.runSubmission(applicationPackageId);
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() < 500) {
        throw new NonRetryableSubmissionError(error.message, error);
      }
      throw error;
    }
  }

  private async runSubmission(
    applicationPackageId: string,
  ): Promise<{ serviceRequestId: string }> {
    const { srId, subject, ownerUserId } =
      await this.ensureScreeningSr(applicationPackageId);

    // the screened person is the only prospect on this SR
    if (!subject.member.prospectId) {
      const owner = await this.userService.findOne(ownerUserId);
      const payload = this.prospectService.buildHouseholdMemberPayload(
        subject.member,
        subject.user,
        owner,
        srId,
      );
      const response = (await this.siebelApiService.createProspect(
        payload,
      )) as { Id?: string; items?: { Id?: string } };
      const prospectId = response?.items?.Id ?? response?.Id;
      if (!prospectId) {
        throw new InternalServerErrorException(
          'Failed to get prospect ID from Siebel',
        );
      }
      await this.householdService.updateHouseholdMember(
        subject.member.householdMemberId,
        { prospectId },
      );
      this.logger.info(
        { applicationPackageId, srId, prospectId },
        'Prospect created for the person being screened',
      );
    }
    const forms =
      await this.applicationFormService.findAllByApplicationPackageId(
        applicationPackageId,
      );
    await this.srAttachmentService.attachFormsToSr(srId, forms, {
      applicationPackageId,
    });
    await this.assertEverythingAttached(applicationPackageId, subject);

    await this.applicationPackageModel.updateOne(
      { applicationPackageId },
      {
        status: ApplicationPackageStatus.SUBMITTED,
        submittedAt: new Date(),
        updatedAt: new Date(),
      },
    );
    this.logger.info(
      { applicationPackageId, srId },
      'Screening package submitted to ICM',
    );
    return { serviceRequestId: srId };
  }

  // attachFormsToSr logs and skips individual failures; a screening must not be marked submitted with something missing
  private async assertEverythingAttached(
    applicationPackageId: string,
    subject: ScreeningSubject,
  ): Promise<void> {
    const forms =
      await this.applicationFormService.findAllByApplicationPackageId(
        applicationPackageId,
      );
    const formsMissing = forms.filter(
      (f) => !f.userAttachedForm && !f.siebelAttachmentId,
    ).length;
    let uploadsMissing = 0;
    if (forms.some((f) => f.userAttachedForm)) {
      const uploads = await this.attachmentsService.findByHouseholdMemberId(
        subject.member.householdMemberId,
      );
      if (uploads.length === 0) {
        throw new NonRetryableSubmissionError(
          'Screening documents were marked as attached but none were uploaded',
        );
      }
      uploadsMissing = uploads.filter((a) => !a.icmAttachmentId).length;
    }
    if (formsMissing || uploadsMissing) {
      throw new Error(
        `Not everything is attached to the service request yet (${formsMissing} form(s), ${uploadsMissing} upload(s)); will retry`,
      );
    }
  }

  private async createScreeningSr(
    bcscDid: string | undefined,
    serviceOffice: string,
    assignee: string,
  ): Promise<string> {
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
    const envSuffix = nodeEnv.toLowerCase().includes('prod') ? '' : nodeEnv;

    const response = (await this.siebelApiService.createServiceRequest(
      {
        Id: 'NULL',
        Status: 'Open',
        Priority: '3-Standard',
        Type: 'Caregiver Screening',
        ...(bcscDid ? { 'ICM BCSC DID': bcscDid } : {}), // DID is only known if the person signed in
        'Service Office': serviceOffice,
        'Comm Method': 'Client Portal',
        Memo: `Created By ${envSuffix} Portal`,
      },
      assignee,
    )) as { items?: { Id?: string } } | undefined;
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
