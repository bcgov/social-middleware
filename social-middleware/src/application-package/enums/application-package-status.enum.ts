export enum ApplicationPackageStatus {
  DRAFT = 'Draft',
  REFERRAL = 'Referral Requested',
  APPLICATION = 'Application',
  AWAITING = 'Awaiting Household',
  SUBMITTED = 'Submitted',
  RETURNED = 'Returned',
  WITHDRAWN = 'Withdrawn',
  ARCHIVED = 'Archived',
}

export enum ServiceRequestStage {
  REFERRAL = 'Referral',
  APPLICATION = 'Application',
  SCREENING = 'Screening',
  ASSESSMENT = 'Assessment',
}
