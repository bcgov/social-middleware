// Relationship values on /Cases/Case/{id}/Contact in ICM.
export enum IcmCaseContactRelationship {
  KeyPlayer = 'Key player',
  Partner = 'Partner',
  Spouse = 'Spouse',
  CommonLaw = 'Common law',
}

export const NON_KEY_PLAYER_RELATIONSHIPS: string[] = [
  IcmCaseContactRelationship.Partner,
  IcmCaseContactRelationship.Spouse,
  IcmCaseContactRelationship.CommonLaw,
];

// exact ICM value not yet confirmed, so match on a fragment
export const RELIEF_RELATIONSHIP = 'relief';
export const ADULT_AGE = 18;
