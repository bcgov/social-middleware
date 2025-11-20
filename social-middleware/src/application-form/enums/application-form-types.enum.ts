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
  [ApplicationFormType.REFERRAL]: 'CF0041',
  [ApplicationFormType.ABOUTME]: 'CF0040',
  [ApplicationFormType.HOUSEHOLD]: 'HOUSEHOLD',
  [ApplicationFormType.PLACEMENT]: 'CF0043',
  [ApplicationFormType.REFERENCES]: 'CF0044',
  [ApplicationFormType.CONSENT]: 'CF0045',
  [ApplicationFormType.SCREENING]: 'CF0040',
};

// helper
export function getFormIdForFormType(FormType: ApplicationFormType): string {
  return FormId[FormType];
}
