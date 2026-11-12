import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { SiebelApiService } from './siebel-api.service';
//import { SiebelPKCEAuthService } from './siebel-pkce-auth.service';
//import { SiebelPKCEAuthController } from './siebel-pkce-auth.controller';
import { SiebelAuthService } from './siebel-auth.service';

@Module({
  imports: [HttpModule, ConfigModule],
  //controllers: [SiebelPKCEAuthController],
  providers: [
    SiebelApiService,
    SiebelAuthService,
    //SiebelPKCEAuthService,
  ],
  exports: [SiebelApiService /*SiebelPKCEAuthService*/],
})
export class SiebelModule {}
