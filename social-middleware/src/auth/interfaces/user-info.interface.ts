export interface UserInfo {
  sub: string;
  email: string;
  name?: string;
  given_names: string;
  family_name: string;
  //gender?: string;
  birthdate: string;
  address: {
    street_address: string;
    country: string;
    region: string;
    locality: string;
    postal_code: string;
  };
}
