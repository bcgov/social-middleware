import { Injectable } from '@nestjs/common';
import { ValidateTokenDto } from './dto/validate-token.dto';

@Injectable()
export class FormsService {
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
