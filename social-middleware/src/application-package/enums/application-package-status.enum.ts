export enum ApplicationPackageStatus {
  DRAFT = 'Draft', // application package has been created
  REFERRAL = 'Referral Requested', // an information session has been requested
  APPLICATION = 'Application', // the full application package is available and being worked on
  CONSENT = 'Consent', // the application package forms and household has been completed. It is locked while consent is being collected from household members
  READY = 'Ready', // the application package has met the requirements for completion and can be submitted to ICM
  SUBMITTED = 'Submitted', // the application packagehas been submitted to ICM
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
