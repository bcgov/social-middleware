export enum RelationshipToPrimary {
  Self = 'Self',
  Spouse = 'Spouse',
  Child = 'Child',
  Parent = 'Parent',
  CommonLaw = 'Common law',
  Sibling = 'Sibling',
  Grandparent = 'Grandparent',
  Grandchild = 'Grandchild',
  Boarder = 'Boarder',
  Partner = 'Partner',
  Other = 'Other',
  ReliefProvider = 'Co Conspirator',
}

import { IcmCaseContactRelationship } from '../../siebel/enums/icm-case-contact-relationship.enum';
// helper
export function getApplicantFlag(Relationship: RelationshipToPrimary): string {
  switch (Relationship) {
    case RelationshipToPrimary.Self:
    case RelationshipToPrimary.Spouse:
    case RelationshipToPrimary.CommonLaw:
    case RelationshipToPrimary.Partner:
      return 'Y';
    default:
      return 'N';
  }
}

export function getIcmRelationship(
  relationship: RelationshipToPrimary,
): string {
  return relationship === RelationshipToPrimary.ReliefProvider
    ? IcmCaseContactRelationship.KeyPlayer
    : relationship;
}
