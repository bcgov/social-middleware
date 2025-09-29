import { Injectable } from '@nestjs/common';
import { GenderTypes } from '../../household/enums/gender-types.enum';

@Injectable()
export class UserUtil {
  sexToGenderType(sex: string): GenderTypes {
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

  icmDateFormat(bcscDate: string): string {
    if (!bcscDate) return '';

    // Validate the input format with regex
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(bcscDate)) {
      throw new Error(
        `Invalid date format: ${bcscDate}. Expected YYYY-MM-DD format.`,
      );
    }
    const [year, month, day] = bcscDate.split('-');
    return `${month}/${day}/${year}`;
  }
}
