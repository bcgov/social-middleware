import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ValidateTokenDto } from './dto/validate-token.dto';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class FormsService {
  constructor(private readonly configService: ConfigService) {}
  generateOneTimeToken(formId: string) {
    const token = randomUUID();
    //may be pass application id here too. Depends on how this is called from application module.
    console.log('formId', formId);
    //save the form parameters agianst the token and user Id for later use.The same will be retrived in the following function
    //form-parameters insert goes here
    return token;
  }
  validateTokenAndGetParameters(dto: ValidateTokenDto) {
    const { token, userId } = dto;
    console.log('token ', token);
    console.log('userId ', userId);

    // Here we could validate the token, e.g., check in DB, verify signature, etc.
    // For now, return dummy values.

    return {
      formId: `CF0001`,
      userId: `abc`,
    };
  }

  expireToken(dto: ValidateTokenDto) {
    const { token, userId } = dto;
    console.log('token ', token);
    console.log('userId ', userId);
    // Here we could expire the token, so that this is not used again.
    // For now, return dummy values.

    return true;
  }
}
