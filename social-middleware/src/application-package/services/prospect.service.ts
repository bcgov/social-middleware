import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { SiebelApiService } from '../../siebel/siebel-api.service';
import { HouseholdService } from 'src/household/services/household.service';
import { UserUtil } from '../../common/utils/user.util';
import { User } from '../../auth/schemas/user.schema';
import { GenderTypes } from 'src/household/enums/gender-types.enum';
import { formatDateForSiebel } from 'src/common/utils/date.util';

export interface ProspectContactOverrides {
  email?: string;
  homePhone?: string;
  alternatePhone?: string;
}

export interface CreateKeyPlayerProspectOptions {
  relationship?: string; // default 'Key player'
  applicantFlag?: string; // default 'Y'
  contact?: ProspectContactOverrides;
  householdMemberId?: string; // if set, persist the prospectId onto this member
}

@Injectable()
export class ProspectService {
  constructor(
    private readonly siebelApiService: SiebelApiService,
    private readonly householdService: HouseholdService,
    private readonly userUtil: UserUtil,
    private readonly logger: PinoLogger,
  ) {}

  /** Pure payload builder for a primary/key-player User. */
  buildKeyPlayerPayload(
    user: User,
    serviceRequestId: string,
    options: CreateKeyPlayerProspectOptions = {},
  ) {
    const { firstName, middleName } = this.userUtil.firstAndMiddleName(
      user.first_name,
    );
    return {
      ServiceRequestId: serviceRequestId,
      IcmBcscDid: user.bc_services_card_id,
      FirstName: firstName,
      MiddleName: middleName,
      LastName: this.userUtil.toTitleCase(user.last_name),
      DateofBirth: formatDateForSiebel(user.dateOfBirth),
      StreetAddress: user.street_address,
      City: user.city,
      Prov: user.region,
      PostalCode: user.postal_code,
      EmailAddress: options.contact?.email || user.email || '',
      HomePhone: options.contact?.homePhone ?? user.home_phone ?? '',
      AlternatePhone:
        options.contact?.alternatePhone || user.alternate_phone || '',
      Gender:
        this.userUtil.sexToGenderType(user.sex) || GenderTypes.Unspecified,
      Relationship: options.relationship ?? 'Key player',
      ApplicantFlag: options.applicantFlag ?? 'Y',
    };
  }

  /** Build + create in Siebel + persist the id onto the household member. */
  async createKeyPlayerProspect(
    user: User,
    serviceRequestId: string,
    options: CreateKeyPlayerProspectOptions = {},
  ): Promise<string> {
    const payload = this.buildKeyPlayerPayload(user, serviceRequestId, options);
    const response = (await this.siebelApiService.createProspect(payload)) as {
      items?: { Id?: string };
    };
    const prospectId = response?.items?.Id;
    if (!prospectId) {
      this.logger.error({ response }, 'Failed to create key-player prospect');
      throw new InternalServerErrorException('Failed to create prospect');
    }
    if (options.householdMemberId) {
      await this.householdService.updateHouseholdMember(
        options.householdMemberId,
        {
          prospectId,
        },
      );
    }
    return prospectId;
  }
}
