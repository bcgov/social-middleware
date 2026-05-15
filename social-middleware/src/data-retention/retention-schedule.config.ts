export interface RetentionRule {
  name: string;
  maxAgeHours: number;
  filter?: Record<string, any>; // extra match conditions merged into the deleteMany query
}

export const RETENTION_SCHEDULE: RetentionRule[] = [
  {
    name: 'FormParameters',
    maxAgeHours: 24, // purge form access tokens older than 24 hours
  },
  {
    name: 'ScreeningAccessCode',
    maxAgeHours: 720, // 30 days
    filter: { isUsed: true },
  },
  // future entries:
  // { name: 'SomethingElse', maxAgeHours: 72 },
];
