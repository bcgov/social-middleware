export enum ApplicationFormType {
  REFERRAL = 'Referral',
  ABOUTME = 'About Me',
}

export const FormId: Record<ApplicationFormType, string> = {
  [ApplicationFormType.REFERRAL]: 'CF0001_Referral',
  [ApplicationFormType.ABOUTME]: 'CF0001_AboutMe',
};

// helper
export function getFormIdForFormType(FormType: ApplicationFormType): string {
  return FormId[FormType];
}
