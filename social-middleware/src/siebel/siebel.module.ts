import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { SiebelController } from './siebel.controller';
import { SiebelService } from './siebel.service';
import { SiebelApiService } from './siebel-api.service';
import { SiebelPKCEAuthService } from './siebel-pkce-auth.service';
import { SiebelPKCEAuthController } from './siebel-pkce-auth.controller';

@Module({
  imports: [HttpModule, ConfigModule],
  controllers: [SiebelController, SiebelPKCEAuthController],
  providers: [SiebelService, SiebelApiService, SiebelPKCEAuthService],
  exports: [SiebelService, SiebelApiService, SiebelPKCEAuthService],
})
export class SiebelModule {}