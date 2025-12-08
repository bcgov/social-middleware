import { RelationshipToPrimary } from '../../household/enums/relationship-to-primary.enum';

export enum ApplicationFormType {
  REFERRAL = 'Referral',
  ABOUTME = 'About Me',
  HOUSEHOLD = 'My household',
  REFERENCES = 'References',
  PLACEMENT = 'Type of placement',
  CONSENT = 'Consents',
  SCREENING = 'Screening',
  ABOUTSPOUSE = 'About Me (Spouse)',
  ABOUTHOUSEHOLD = 'About Me (Household)',
}

// referral and household forms do not use FF forms;
export const FormId: Record<ApplicationFormType, string> = {
  //[ApplicationFormType.REFERRAL]: 'CF0041',
  [ApplicationFormType.REFERRAL]: 'REFERRAL',
  [ApplicationFormType.ABOUTME]: 'CF0040',
  [ApplicationFormType.HOUSEHOLD]: 'HOUSEHOLD',
  [ApplicationFormType.PLACEMENT]: 'CF0043',
  [ApplicationFormType.REFERENCES]: 'CF0044',
  [ApplicationFormType.CONSENT]: 'CF0045',
  [ApplicationFormType.SCREENING]: 'CF0040',
  [ApplicationFormType.ABOUTSPOUSE]: 'CF0046',
  [ApplicationFormType.ABOUTHOUSEHOLD]: 'CF0047',
};

// helper
export function getFormIdForFormType(FormType: ApplicationFormType): string {
  return FormId[FormType];
}

// helper
export function getScreeningFormRecipe(
  Type: RelationshipToPrimary,
): ApplicationFormType[] {
  switch (Type) {
    case RelationshipToPrimary.Spouse:
    case RelationshipToPrimary.Partner:
    case RelationshipToPrimary.CommonLaw:
      return [ApplicationFormType.ABOUTSPOUSE, ApplicationFormType.CONSENT];
    default:
      return [ApplicationFormType.ABOUTHOUSEHOLD, ApplicationFormType.CONSENT];
  }
}
