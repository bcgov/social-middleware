import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AccessCodeType } from 'src/household/enums/access-code-type.enum';
import { RelationshipToPrimary } from 'src/household/enums/relationship-to-primary.enum';
import { AccessCodeService } from 'src/household/services/access-code.service';
import { HouseholdService } from 'src/household/services/household.service';
import { NotificationService } from 'src/notifications/services/notification.service';
import { SiebelApiService } from 'src/siebel/siebel-api.service';
import { v4 as uuidv4 } from 'uuid';
import {
  ApplicationPackageStatus,
  ServiceRequestStage,
} from '../enums/application-package-status.enum';
import {
  ApplicationPackageSubSubType,
  ApplicationPackageSubType,
} from '../enums/application-package-subtypes.enum';
import { ProspectiveCaregiver } from '../interfaces/prospective-caregiver.interface';
import { ApplicationPackage } from '../schema/application-package.schema';

@Injectable()
export class CaregiverInvitationService {
  constructor(
    @InjectModel(ApplicationPackage.name)
    private applicationPackageModel: Model<ApplicationPackage>,
    private readonly accessCodeService: AccessCodeService,
    private readonly householdService: HouseholdService,
    private readonly siebelApiService: SiebelApiService,
    private readonly notificationService: NotificationService,
    @InjectPinoLogger(CaregiverInvitationService.name)
    private readonly logger: PinoLogger,
  ) {}

  async processProspectiveCaregiver(
    caregiver: ProspectiveCaregiver,
  ): Promise<void> {
    // 1. idempotency check - is the srId linked to an application package already..
    const existing = await this.applicationPackageModel
      .findOne({ srId: caregiver.srId })
      .lean();

    // it is already linked..
    if (existing) {
      // Check if it has a userId; meaning it was completed
      if (existing.userId) {
        this.logger.info(
          { srId: caregiver.srId },
          'Access code already redeemed — skipping',
        );
        return;
      }

      // Not yet redeemed — resend if expired
      const member = await this.householdService.findPrimaryApplicant(
        existing.applicationPackageId,
      );
      if (member) {
        const { isNew, accessCode } =
          await this.accessCodeService.resendOrCreateAccessCode(
            member.householdMemberId,
            existing.applicationPackageId,
            AccessCodeType.NEW_APPLICATION,
          );
        if (isNew) {
          await this.notificationService.sendCaregiverInvitation(
            caregiver.email,
            caregiver.firstName,
            accessCode,
          );
          this.logger.info(
            {
              srId: caregiver.srId,
              applicationPackageId: existing.applicationPackageId,
            },
            'Resent expired access code for prospective caregiver',
          );
        }
      }
      return;
    }

    // 2. create application package placeholder
    const applicationPackageId = uuidv4();
    await this.applicationPackageModel.create({
      applicationPackageId: applicationPackageId,
      userId: null,
      subtype: caregiver.subtype,
      subsubtype: caregiver.subsubtype,
      status: ApplicationPackageStatus.DRAFT,
      contactId: caregiver.contactId,
      srId: caregiver.srId,
      srStage: ServiceRequestStage.REFERRAL,
    });

    // 3. create primary HouseholdMember from ICM Contact data

    const member = await this.householdService.createMember({
      applicationPackageId,
      firstName: caregiver.firstName,
      lastName: caregiver.lastName,
      dateOfBirth: caregiver.dateOfBirth,
      email: caregiver.email,
      relationshipToPrimary: RelationshipToPrimary.Self,
    });

    // 4. generate access code
    const { accessCode } = await this.accessCodeService.createAccessCode(
      member.householdMemberId,
      applicationPackageId,
      AccessCodeType.NEW_APPLICATION,
    );

    // 5. send invitation email
    await this.notificationService.sendCaregiverInvitation(
      caregiver.email,
      caregiver.firstName,
      accessCode,
    );

    this.logger.info(
      { applicationPackageId, srId: caregiver.srId },
      'Caregiver invitation sent',
    );
  }

  async pollKinshipReferrals(): Promise<void> {
    this.logger.info(
      'Polling Siebel for Kinship referral SRs with prospective caregivers',
    );

    let srs;
    try {
      srs =
        await this.siebelApiService.getNewKinshipSRsForProspectiveCaregivers();
    } catch (error) {
      this.logger.error(
        { error },
        'Failed to poll Siebel for Kinship referral SRs',
      );
      return;
    }

    this.logger.info(
      { count: srs.length },
      'Found Kinship referral SRs with prospective caregivers',
    );

    for (const sr of srs) {
      const srId = sr.Id!;
      const contactId = sr['Primary Contact Id']!;

      //this.logger.debug({ srId: srId, contactId: contactId });

      try {
        const contact =
          await this.siebelApiService.getIcmContactById(contactId);

        if (!contact) {
          this.logger.warn(
            { srId, contactId },
            'Contact not found — skipping SR',
          );
          continue;
        }

        if (!contact['Primary Email']?.trim()) {
          this.logger.warn(
            { srId, contactId },
            'Contact has no Primary Email — skipping SR',
          );
          continue;
        }

        if (!contact['Birth Date']) {
          this.logger.warn(
            { srId, contactId },
            'Contact has no Birth Date — skipping SR',
          );
          continue;
        }

        const [month, day, year] = contact['Birth Date'].split('/');
        const dateOfBirth = `${year}-${month}-${day}`;

        const caregiver: ProspectiveCaregiver = {
          firstName: contact['First Name'],
          lastName: contact['Last Name'],
          dateOfBirth,
          email: contact['Primary Email'],
          contactId,
          srId,
          subtype: ApplicationPackageSubType.OOC,
          subsubtype: ApplicationPackageSubSubType._BLANK,
        };

        await this.processProspectiveCaregiver(caregiver);
      } catch (error) {
        this.logger.error(
          { error, srId, contactId },
          'Failed to process Kinship referral SR — continuing to next',
        );
      }
    }
  }
}
