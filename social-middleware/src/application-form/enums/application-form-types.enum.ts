import { RelationshipToPrimary } from '../../household/enums/relationship-to-primary.enum';

// the types of form supported in the system; the string is the label that will appear on the page and in the tables of contents
export enum ApplicationFormType {
  REFERRAL = 'Referral',
  INDIGENOUS = 'Indigenous Background and Preferences',
  ABOUTME = 'About Me',
  HOUSEHOLD = 'Adults in household',
  CHILDREN = 'Children in household',
  REFERENCES = 'References',
  PLACEMENT = 'Type of placement',
  DISCLOSURECONSENT = 'Consent for Disclosure of Criminal Record Information',
  PCCCONSENT = 'Consent for Prior Contact Check',
  SCREENING = 'Screening',
  ABOUTSPOUSE = 'About Me (Spouse)',
  ABOUTHOUSEHOLD = 'About Me (Household)',
}

// referral and household forms do not use FF forms;
export const FormId: Record<ApplicationFormType, string> = {
  [ApplicationFormType.REFERRAL]: 'REFERRAL',
  [ApplicationFormType.INDIGENOUS]: 'CF0041',
  [ApplicationFormType.ABOUTME]: 'CF0040',
  [ApplicationFormType.HOUSEHOLD]: 'HOUSEHOLD',
  [ApplicationFormType.CHILDREN]: 'CF0042',
  [ApplicationFormType.PLACEMENT]: 'CF0043',
  [ApplicationFormType.REFERENCES]: 'CF0044',
  [ApplicationFormType.DISCLOSURECONSENT]: 'CF0045',
  [ApplicationFormType.PCCCONSENT]: 'CF0048',
  [ApplicationFormType.SCREENING]: 'CF0040',
  [ApplicationFormType.ABOUTSPOUSE]: 'CF0046',
  [ApplicationFormType.ABOUTHOUSEHOLD]: 'CF0047',
};

// helper to return formID by formType
export function getFormIdForFormType(FormType: ApplicationFormType): string {
  return FormId[FormType];
}

// helper to generate the forms for various household member types
export function getScreeningFormRecipe(
  Type: RelationshipToPrimary,
): ApplicationFormType[] {
  switch (Type) {
    case RelationshipToPrimary.Spouse:
    case RelationshipToPrimary.Partner:
    case RelationshipToPrimary.CommonLaw:
      return [
        ApplicationFormType.ABOUTSPOUSE,
        ApplicationFormType.DISCLOSURECONSENT,
        ApplicationFormType.PCCCONSENT,
      ];
    default:
      return [
        ApplicationFormType.ABOUTHOUSEHOLD,
        ApplicationFormType.DISCLOSURECONSENT,
        ApplicationFormType.PCCCONSENT,
      ];
  }
}
