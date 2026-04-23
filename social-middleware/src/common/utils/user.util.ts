import { Injectable } from '@nestjs/common';
import { GenderTypes } from '../../household/enums/gender-types.enum';

@Injectable()
export class UserUtil {
  sexToGenderType(sex?: string): GenderTypes {
    if (!sex) {
      return GenderTypes.Unspecified;
    }
    switch (sex.toLowerCase()) {
      case 'male':
      case 'man/boy':
        return GenderTypes.ManBoy;
      case 'female':
      case 'woman/girl':
        return GenderTypes.WomanGirl;
      case 'non-binary':
        return GenderTypes.NonBinary;
      default:
        return GenderTypes.Unspecified;
    }
  }

  toTitleCase(str: string): string {
    if (!str) return str;
    return str.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
  }

  // convert a BCSC Given Name into first and middle names (if they exist)
  firstAndMiddleName(str: string): {
    firstName: string;
    middleName: string;
  } {
    const nameParts = str.trim().split(/\s+/);
    return {
      firstName: this.toTitleCase(nameParts[0]),
      middleName: this.toTitleCase(nameParts.slice(1).join(' ')), // split off the middlenames if they exist
    };
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
