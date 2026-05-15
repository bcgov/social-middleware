import { compareDates, formatDateForSiebel } from './date.util';

describe('compareDates', () => {
  it('returns true for identical date strings', () => {
    expect(compareDates('2024-01-15', '2024-01-15')).toBe(true);
  });

  it('returns false for different days', () => {
    expect(compareDates('2024-01-15', '2024-01-16')).toBe(false);
  });

  it('returns false for different months', () => {
    expect(compareDates('2024-01-15', '2024-02-15')).toBe(false);
  });

  it('returns false for different years', () => {
    expect(compareDates('2023-01-15', '2024-01-15')).toBe(false);
  });

  it('returns false when the first date is invalid', () => {
    expect(compareDates('not-a-date', '2024-01-15')).toBe(false);
  });

  it('returns false when the second date is invalid', () => {
    expect(compareDates('2024-01-15', 'not-a-date')).toBe(false);
  });

  it('returns false when both dates are invalid', () => {
    expect(compareDates('not-a-date', 'also-invalid')).toBe(false);
  });
});

describe('formatDateForSiebel', () => {
  it('formats a Date object to MM/DD/YYYY', () => {
    expect(formatDateForSiebel(new Date(2024, 0, 15))).toBe('01/15/2024');
  });

  it('pads single-digit months and days with a leading zero', () => {
    expect(formatDateForSiebel(new Date(2024, 2, 5))).toBe('03/05/2024');
  });

  it('formats a Date object at year boundaries correctly', () => {
    expect(formatDateForSiebel(new Date(2024, 11, 31))).toBe('12/31/2024');
  });

  it('throws for an invalid date string', () => {
    expect(() => formatDateForSiebel('not-a-date')).toThrow(
      'Invalid date: not-a-date',
    );
  });
});
