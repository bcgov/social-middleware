export enum ApplicationFormType {
  REFERRAL = 'Referral',
  ABOUTME = 'About Me',
  HOUSEHOLD = 'My household and support network',
  REFERENCES = 'References',
  CONSENT = 'Consent and agreements',
  SCREENING = 'Screening',
}

export const FormId: Record<ApplicationFormType, string> = {
  [ApplicationFormType.REFERRAL]: 'CF0001_Referral',
  [ApplicationFormType.ABOUTME]: 'CF0001_AboutMe',
  [ApplicationFormType.HOUSEHOLD]: 'HOUSEHOLD',
  [ApplicationFormType.REFERENCES]: 'CF0001_References',
  [ApplicationFormType.CONSENT]: 'CF0001_Consent',
  [ApplicationFormType.SCREENING]: 'CF0001_AboutMe',
};

// helper
export function getFormIdForFormType(FormType: ApplicationFormType): string {
  return FormId[FormType];
}
