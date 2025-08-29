export interface IcmContact {
  gender?: string; // maps "M/F"
  rowId: string; // maps "Row Id"
  joinedAkaLastName?: string; // "Joined AKA Last Name"
  joinedAkaFirstName?: string; // "Joined AKA First Name"
  deceasedFlag?: string; // "Deceased Flag"
  primaryContactAddressId?: string; // "Primary Contact Address Id"
  employeeFlag?: string; // "Employee Flag"
  joinedAkaMiddleName?: string; // "Joined AKA Middle Name"
  deceasedDate?: string; // "Deceased Date"
  lastName?: string; // "Last Name"
  middleName?: string; // "Middle Name"
  firstName?: string; // "First Name"
}

export interface SiebelContactResponse {
  items: IcmContact[];
}
