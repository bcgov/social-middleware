import { ServiceRequestStage } from './application-package-status.enum';

export enum ApplicationPackageSubType {
  FCH = 'FCH',
  OOC = 'OOC',
  PROSPECTIVE = 'Prospective Caregiver',
}

export enum ApplicationPackageSubSubType {
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
