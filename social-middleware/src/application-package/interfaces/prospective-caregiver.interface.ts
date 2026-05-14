import {
  ApplicationPackageSubType,
  ApplicationPackageSubSubType,
} from '../enums/application-package-subtypes.enum';

export interface ProspectiveCaregiver {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email: string;
  contactId: string;
  activityId: string;
  subtype: ApplicationPackageSubType;
  subsubtype: ApplicationPackageSubSubType;
}
