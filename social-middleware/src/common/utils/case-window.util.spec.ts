import { BadRequestException } from '@nestjs/common';
import { assertWithinCaseWindow } from './case-window.util';

describe('assertWithinCaseWindow', () => {
  const caseOpen = new Date('2026-01-01T00:00:00'); // local midnight

  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-23T12:00:00'));
  });
  afterAll(() => jest.useRealTimers());

  const ok = (v: string, open: Date | null = caseOpen) =>
    expect(() => assertWithinCaseWindow(v, open)).not.toThrow();
  const bad = (v: string, msg: RegExp, open: Date | null = caseOpen) => {
    expect(() => assertWithinCaseWindow(v, open)).toThrow(BadRequestException);
    expect(() => assertWithinCaseWindow(v, open)).toThrow(msg);
  };

  it('accepts today', () => ok('2026-10-23'));
  it('accepts a past date after the case opened', () => ok('2026-03-15'));
  it('accepts the case open date itself', () => ok('2026-01-01'));
  it('accepts exactly 2 years from today', () => ok('2028-10-23'));
  it('rejects 2 years plus a day', () =>
    bad('2028-10-24', /more than 2 years/));
  it('rejects the day before the case opened', () =>
    bad('2025-12-31', /before the resource case opened/));
  it('rejects an impossible calendar date', () =>
    bad('2026-02-31', /not a valid date/));
  it.each(['', '2026/10/23', '23-10-2026', 'tomorrow'])('rejects %p', (v) =>
    bad(v, /not a valid date/),
  );
  it('skips the lower bound when there is no case open date', () => {
    expect(() => assertWithinCaseWindow('2000-01-01', null)).not.toThrow();
    expect(() => assertWithinCaseWindow('2000-01-01', undefined)).not.toThrow();
  });
  it('uses the label in the message', () => {
    expect(() =>
      assertWithinCaseWindow('nope', caseOpen, 'Date of departure'),
    ).toThrow('Date of departure is not a valid date');
  });
});
