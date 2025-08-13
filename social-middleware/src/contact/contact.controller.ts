import { Controller, Get, Query} from '@nestjs/common';
import { ContactService } from './contact.service';

@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Get('get')
  async getContact(@Query('birthDate') birthDate: string) {
    return this.contactService.getContactByBirthDate(birthDate);
  }
}
