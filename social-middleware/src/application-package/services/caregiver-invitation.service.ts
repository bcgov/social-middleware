import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ApplicationPackage } from '../schema/application-package.schema';
//import { ApplicationPackageService } from './application-package.service';
//import { HouseholdMembers } from 'src/household/schemas/household-members.schema';
import { AccessCodeService } from 'src/household/services/access-code.service';
import { AccessCodeType } from 'src/household/enums/access-code-type.enum';
import { HouseholdService } from 'src/household/services/household.service';
import { NotificationService } from 'src/notifications/services/notification.service';
import { SiebelApiService } from 'src/siebel/siebel-api.service';
import { ApplicationPackageStatus } from '../enums/application-package-status.enum';
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';
import { v4 as uuidv4 } from 'uuid';
import { RelationshipToPrimary } from 'src/household/enums/relationship-to-primary.enum';
import { ProspectiveCaregiver } from '../interfaces/prospective-caregiver.interface';

@Injectable()
export class CaregiverInvitationService {
  constructor(
    @InjectModel(ApplicationPackage.name)
    private applicationPackageModel: Model<ApplicationPackage>,
    //@InjectModel(HouseholdMembers.name)
    //private householdMembersModel: Model<HouseholdMembers>,
    //private applicationPackageService: ApplicationPackageService,
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
    // 1. idempotency check
    const existing = await this.applicationPackageModel
      .findOne({
        contactId: caregiver.contactId,
        activityId: caregiver.activityId,
      })
      .lean();

    if (existing) {
      this.logger.info(
        { contactId: caregiver.contactId },
        'Already processed - skipping',
      );
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
      activityId: caregiver.activityId,
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

    // 6. Create Service Request Linked to Contact and Activity
    const sr = await this.siebelApiService.createCaregiverApplicationSR(
      caregiver.subtype,
      caregiver.subsubtype,
      '',
      caregiver.contactId,
      caregiver.activityId,
    );

    // 7. store the srID on the package
    await this.applicationPackageModel.updateOne(
      { applicationPackageId: applicationPackageId },
      { srId: sr.srId },
    );

    this.logger.info(
      { applicationPackageId, accessCode, srId: sr.srId },
      'Caregiver invitation sent',
    );
  }
}
