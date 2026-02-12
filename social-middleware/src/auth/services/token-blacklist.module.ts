import { Module } from '@nestjs/common';
import { TokenBlacklistService } from './token-blacklist.service';

@Module({
  providers: [TokenBlacklistService],
  exports: [TokenBlacklistService],
})
export class TokenBlacklistModule {}
