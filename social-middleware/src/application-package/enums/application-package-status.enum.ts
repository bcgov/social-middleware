export enum ApplicationPackageStatus {
  DRAFT = 'Draft', // application package has been created
  REFERRAL = 'Referral Requested', // an information session has been requested
  APPLICATION = 'Application', // the full application package is available and being worked on
  CONSENT = 'Consent', // the application package is 'complete' and is locked while consent is being collected from household members
  SUBMITTED = 'Submitted', // the application package with required consents has been submitted to ICM
  RETURNED = 'Returned', // not yet implemented
  WITHDRAWN = 'Withdrawn', // not yet implemented
  ARCHIVED = 'Archived', // not yet implemented
}

export enum ServiceRequestStage {
  REFERRAL = 'Referral',
  APPLICATION = 'Application',
  SCREENING = 'Screening',
  ASSESSMENT = 'Assessment',
}
