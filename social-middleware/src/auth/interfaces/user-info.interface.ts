export interface UserInfo {
  sub: string;
  email: string;
  name?: string;
  given_name: string;
  family_name: string;
  gender?: string;
  birthdate: string;
  address: {
    street_address: string;
    country: string;
    region: string;
    locality: string;
    postal_code: string;
  };
}
