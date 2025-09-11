import { Controller, Get, Query, ValidationPipe } from '@nestjs/common';
import { ContactService } from './contact.service';
import { GetContactQueryDto } from './dto/get-contact-query.dto';

@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Get('get')
  async getContact(
    @Query(new ValidationPipe({ whitelist: true, transform: true }))
    query: GetContactQueryDto,
  ) {
    return this.contactService.getContactByBirthDate(query.birthDate);
  }
}
