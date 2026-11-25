// ICM 'Case Sub Type' values we care about; every other value is ignored
export enum IcmCaseSubType {
  FCH = 'FCH',
  OUT_OF_CARE = 'Out of Care',
  FCH_OUT_OF_CARE = 'FCH/Out of Care',
}

export function parseCaseSubType(raw?: unknown): IcmCaseSubType | undefined {
  const value = typeof raw === 'string' ? raw.trim() : '';
  return Object.values(IcmCaseSubType).find(
    (v) => v.toLowerCase() === value.toLowerCase(),
  );
}

// FCH features also apply to combined cases
export function isFchCase(subType?: IcmCaseSubType): boolean {
  return (
    subType === IcmCaseSubType.FCH || subType === IcmCaseSubType.FCH_OUT_OF_CARE
  );
}
