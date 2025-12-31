export interface UserProfileResponse {
  first_name: string;
  last_name: string;
  date_of_birth: string;
  street_address: string;
  city: string;
  region: string;
  postal_code: string;
  email: string;
  home_phone?: string;
  alternate_phone?: string;
}
