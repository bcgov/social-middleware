// The ICM Relationship values on /Cases/Case/{id}/Contact that the portal
// stores. Anything not listed is not a household relationship we manage and is
// skipped at sync. Add a value here to start storing it.
export enum IcmCaseContactRelationship {
  KeyPlayer = 'Key player',
  Partner = 'Partner',
  Spouse = 'Spouse',
  CommonLaw = 'Common law',
  Child = 'Child',
  Parent = 'Parent',
  Sibling = 'Sibling',
  Grandparent = 'Grandparent',
  Grandchild = 'Grandchild',
  Boarder = 'Boarder',
  Other = 'Other',
  Relief = 'Relief Caregiver',
}

const STORED_RELATIONSHIPS = new Set<string>(
  Object.values(IcmCaseContactRelationship),
);

export function isStoredRelationship(
  value: string | undefined,
): value is IcmCaseContactRelationship {
  return value !== undefined && STORED_RELATIONSHIPS.has(value);
}

export const NON_KEY_PLAYER_RELATIONSHIPS: string[] = [
  IcmCaseContactRelationship.Partner,
  IcmCaseContactRelationship.Spouse,
  IcmCaseContactRelationship.CommonLaw,
];

export const CAREGIVER_RELATIONSHIPS: string[] = [
  IcmCaseContactRelationship.KeyPlayer,
  ...NON_KEY_PLAYER_RELATIONSHIPS,
];

// stored, but not adults the caregiver manages on the Manage Household page
export const NOT_MANAGEABLE_RELATIONSHIPS: string[] = [
  ...CAREGIVER_RELATIONSHIPS,
  IcmCaseContactRelationship.Relief,
];

export const ADULT_AGE = 18;
