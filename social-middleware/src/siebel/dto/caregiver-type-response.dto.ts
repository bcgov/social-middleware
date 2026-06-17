import { IcmCaregiverType } from '../enums/icm-caregiver-type.enum';

export interface CaregiverTypeItem {
  Id: string;
  'Caregiver Type': IcmCaregiverType;
  'Case Num': string;
  'Service Request Num': string;
  'Start Date': string;
  'End Date': string;
}

export interface CaregiverTypesResponse {
  items: CaregiverTypeItem[];
  lastpage: string;
}

export interface IcmContactDetail {
  Id: string;
  'First Name': string;
  'Last Name': string;
  'Birth Date': string;
  'Primary Email': string;
}
