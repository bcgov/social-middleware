export enum ApplicationFormType {
  REFERRAL = 'Referral',
  ABOUTME = 'About Me',
}

export const FormId: Record<ApplicationFormType, string> = {
  [ApplicationFormType.REFERRAL]: 'CF0001',
  [ApplicationFormType.ABOUTME]: 'CF0001',
};

// helper
export function getFormIdForFormType(FormType: ApplicationFormType): string {
  return FormId[FormType];
}
