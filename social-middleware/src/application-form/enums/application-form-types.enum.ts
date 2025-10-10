export enum ApplicationFormType {
  REFERRAL = 'Referral',
  ABOUTME = 'About Me',
  ADDRESS = 'Current and past addresses',
  HOUSEHOLD = 'My household and support network',
  HEALTH = 'Health history',
  HISTORY = 'Caregiving history',
  REFERENCES = 'References',
  CONSENT = 'Consent and agreements',
}

export const FormId: Record<ApplicationFormType, string> = {
  [ApplicationFormType.REFERRAL]: 'CF0001_Referral',
  [ApplicationFormType.ABOUTME]: 'CF0001_AboutMe',
  [ApplicationFormType.ADDRESS]: 'CF0001_AboutMe',
  [ApplicationFormType.HOUSEHOLD]: 'HOUSEHOLD',
  [ApplicationFormType.HEALTH]: 'CF0001_AboutMe',
  [ApplicationFormType.HISTORY]: 'CF0001_AboutMe',
  [ApplicationFormType.REFERENCES]: 'CF0001_AboutMe',
  [ApplicationFormType.CONSENT]: 'CF0001_AboutMe',
};

// helper
export function getFormIdForFormType(FormType: ApplicationFormType): string {
  return FormId[FormType];
}
