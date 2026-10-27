import { NonKeyPlayerCaregiver } from '../schemas/user.schema';
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
  gender?: string;
  previous_first_name?: string;
  previous_last_name?: string;
  resource_case_active_date?: Date;
  non_key_player_caregiver?: NonKeyPlayerCaregiver | null;
}
