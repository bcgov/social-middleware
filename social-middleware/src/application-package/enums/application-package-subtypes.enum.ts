import { ServiceRequestStage } from './application-package-status.enum';

export enum ApplicationPackageSubType {
  FCH = 'FCH',
  OOC = 'Kinship',
  PROSPECTIVE = 'Prospective Caregiver',
  ADDITIONAL_ADULT = 'Additional Adult',
  RELIEF_PROVIDER = 'Relief Provider',
}

// Packages for one person who is screened on their own Caregiver Screening service request,
// not an application made by the primary applicant. Add RELIEF_PROVIDER here when it exists.
export const SCREENING_SUBTYPES: readonly ApplicationPackageSubType[] = [
  ApplicationPackageSubType.ADDITIONAL_ADULT,
  ApplicationPackageSubType.RELIEF_PROVIDER,
];

export function isScreeningSubtype(subtype?: string | null): boolean {
  return (
    !!subtype && (SCREENING_SUBTYPES as readonly string[]).includes(subtype)
  );
}

// The SR Sub Type ICM expects on the Caregiver Screening SR, by package subtype.
// Additional Adult sends none.
export const ScreeningSRSubTypes: Partial<
  Record<ApplicationPackageSubType, string>
> = {
  [ApplicationPackageSubType.RELIEF_PROVIDER]: 'Relief(Appendix F)',
};

export enum ApplicationPackageSubSubType {
  _BLANK = '',
  FCH = 'FCH',
  RESTRICTEDFCH = 'Restricted FCH',
  CUSTODYTOOTHER = 'Custody to Other (Interim/Temporary)',
  EFP = 'EFP',
  FIFTYFOURPOINT1 = '54.1',
  FIFTYFOURPOINT01 = '54.01',
}

export enum ReferralState {
  NEW = 'New',
  REQUESTED = 'Requested',
  COMPLETE = 'COMPLETE',
}

export function getDefaultSrStage(
  subtype: ApplicationPackageSubType,
): ServiceRequestStage {
  switch (subtype) {
    case ApplicationPackageSubType.FCH:
      return ServiceRequestStage.REFERRAL;
    case ApplicationPackageSubType.OOC:
      return ServiceRequestStage.APPLICATION;
    default:
      return ServiceRequestStage.NEW;
  }
}
