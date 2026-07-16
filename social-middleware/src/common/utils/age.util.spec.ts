import { calculateAge } from './age.util';

describe('calculateAge', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-06-15'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns correct age when birthday has already occurred this year', () => {
    expect(calculateAge('1994-03-10')).toBe(30);
  });

  it('returns correct age when birthday has not yet occurred this year', () => {
    expect(calculateAge('1994-09-20')).toBe(29);
  });

  it('returns correct age when today is the birthday', () => {
    expect(calculateAge('1994-06-15')).toBe(30);
  });

  it('subtracts a year when the birthday is later in the same month', () => {
    expect(calculateAge('1994-06-20')).toBe(29);
  });
});
