import { Matches } from 'class-validator';

export class RequestHouseholdRemovalDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'departure_date must be YYYY-MM-DD',
  })
  departure_date!: string;
}
