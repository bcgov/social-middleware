import { UserUtil } from './user.util';
import { GenderTypes } from 'src/household/enums/gender-types.enum';

describe('UserUtil', () => {
  let util: UserUtil;

  beforeEach(() => {
    util = new UserUtil();
  });

  describe('sexToGenderType', () => {
    it('maps "male" to ManBoy', () => {
      expect(util.sexToGenderType('male')).toBe(GenderTypes.ManBoy);
    });

    it('maps "man/boy" to ManBoy', () => {
      expect(util.sexToGenderType('man/boy')).toBe(GenderTypes.ManBoy);
    });

    it('maps "female" to WomanGirl', () => {
      expect(util.sexToGenderType('female')).toBe(GenderTypes.WomanGirl);
    });

    it('maps "woman/girl" to WomanGirl', () => {
      expect(util.sexToGenderType('woman/girl')).toBe(GenderTypes.WomanGirl);
    });

    it('maps "non-binary" to NonBinary', () => {
      expect(util.sexToGenderType('non-binary')).toBe(GenderTypes.NonBinary);
    });

    it('returns Unspecified for undefined', () => {
      expect(util.sexToGenderType(undefined)).toBe(GenderTypes.Unspecified);
    });

    it('returns Unspecified for an unrecognised value', () => {
      expect(util.sexToGenderType('other')).toBe(GenderTypes.Unspecified);
    });

    it('is case-insensitive', () => {
      expect(util.sexToGenderType('MALE')).toBe(GenderTypes.ManBoy);
    });
  });

  describe('toTitleCase', () => {
    it('capitalises the first letter of each word', () => {
      expect(util.toTitleCase('hello world')).toBe('Hello World');
    });

    it('lowercases the remainder of each word', () => {
      expect(util.toTitleCase('JOHN DOE')).toBe('John Doe');
    });

    it('handles a single word', () => {
      expect(util.toTitleCase('jane')).toBe('Jane');
    });

    it('returns an empty string unchanged', () => {
      expect(util.toTitleCase('')).toBe('');
    });
  });

  describe('firstAndMiddleName', () => {
    it('returns firstName only when input is a single name', () => {
      expect(util.firstAndMiddleName('john')).toEqual({
        firstName: 'John',
        middleName: '',
      });
    });

    it('splits a first and middle name', () => {
      expect(util.firstAndMiddleName('john michael')).toEqual({
        firstName: 'John',
        middleName: 'Michael',
      });
    });

    it('joins multiple middle names into one string', () => {
      expect(util.firstAndMiddleName('john michael james')).toEqual({
        firstName: 'John',
        middleName: 'Michael James',
      });
    });

    it('trims leading and trailing whitespace', () => {
      expect(util.firstAndMiddleName('  john  ')).toEqual({
        firstName: 'John',
        middleName: '',
      });
    });
  });

  describe('icmDateFormat', () => {
    it('converts YYYY-MM-DD to MM/DD/YYYY', () => {
      expect(util.icmDateFormat('2024-03-15')).toBe('03/15/2024');
    });

    it('returns an empty string for empty input', () => {
      expect(util.icmDateFormat('')).toBe('');
    });

    it('throws for a date in DD-MM-YYYY format', () => {
      expect(() => util.icmDateFormat('15-03-2024')).toThrow(
        'Invalid date format',
      );
    });

    it('throws for a non-date string', () => {
      expect(() => util.icmDateFormat('not-a-date')).toThrow(
        'Invalid date format',
      );
    });
  });
});
