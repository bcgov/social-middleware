export enum ApplicationFormType {
  REFERRAL = 'Referral',
  ABOUTME = 'About Me',
  HOUSEHOLD = 'My household',
  REFERENCES = 'References',
  PLACEMENT = 'Type of placement',
  CONSENT = 'Consents',
  SCREENING = 'Screening',
}

export const FormId: Record<ApplicationFormType, string> = {
  [ApplicationFormType.REFERRAL]: 'CF0001_Referral',
  [ApplicationFormType.ABOUTME]: 'CF0001_AboutMe',
  [ApplicationFormType.HOUSEHOLD]: 'HOUSEHOLD',
  [ApplicationFormType.REFERENCES]: 'CF0001_References',
  [ApplicationFormType.PLACEMENT]: 'CF0001_Placement',
  [ApplicationFormType.CONSENT]: 'CF0001_Consents',
  [ApplicationFormType.SCREENING]: 'CF0001_Referral',
};

// helper
export function getFormIdForFormType(FormType: ApplicationFormType): string {
  return FormId[FormType];
}
