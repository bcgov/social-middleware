import {
  IcmCaseSubType,
  isFchCase,
  parseCaseSubType,
} from 'src/siebel/enums/icm-case-sub-type.enum';

describe('parseCaseSubType', () => {
  it.each([
    ['FCH', IcmCaseSubType.FCH],
    ['Out of Care', IcmCaseSubType.OUT_OF_CARE],
    ['FCH/Out of Care', IcmCaseSubType.FCH_OUT_OF_CARE],
    ['  fch/out of care ', IcmCaseSubType.FCH_OUT_OF_CARE],
  ])('parses %p', (raw, expected) => {
    expect(parseCaseSubType(raw)).toBe(expected);
  });

  it.each([['Kinship'], [''], ['   '], [undefined], [null], [42]])(
    'returns undefined for %p',
    (raw) => {
      expect(parseCaseSubType(raw)).toBeUndefined();
    },
  );
});

describe('isFchCase', () => {
  it('is true for FCH and combined cases only', () => {
    expect(isFchCase(IcmCaseSubType.FCH)).toBe(true);
    expect(isFchCase(IcmCaseSubType.FCH_OUT_OF_CARE)).toBe(true);
    expect(isFchCase(IcmCaseSubType.OUT_OF_CARE)).toBe(false);
    expect(isFchCase(undefined)).toBe(false);
  });
});
