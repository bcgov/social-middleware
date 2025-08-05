import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { ContactService } from './contact.service';

@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Get('get')
  async getContact(@Query('birthDate') birthDate: string) {
    if (!birthDate) {
      throw new BadRequestException(
        'Missing required query parameter: birthDate',
      );
    }
    return this.contactService.getContactByBirthDate(birthDate);
  }
}
