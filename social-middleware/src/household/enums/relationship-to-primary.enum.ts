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
}

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
