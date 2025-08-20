import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SiebelAuthService } from './siebel-auth.service';
import { SiebelApiService } from './siebel-api.service';

@Module({
  imports: [HttpModule],
  providers: [SiebelAuthService, SiebelApiService],
  exports: [SiebelApiService],
})
export class SiebelModule {}
