import { GenderTypes } from 'src/household/enums/gender-types.enum';

export function sexToGenderType(sex: string): GenderTypes {
  switch (sex.toLowerCase()) {
    case 'male':
      return GenderTypes.ManBoy;
    case 'female':
      return GenderTypes.WomanGirl;
    case 'non-binary':
      return GenderTypes.NonBinary;
    default:
      return GenderTypes.Unspecified;
  }
}
