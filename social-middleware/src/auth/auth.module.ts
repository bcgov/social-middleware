// auth/auth.module.ts

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { BcscOAuthService } from './bcsc-oauth.service';
import { UserService } from './user.service';
import { HttpModule } from '@nestjs/axios';
import { User, UserSchema } from './schemas/user.schema';
import { SiebelModule } from 'src/siebel/siebel.module';
import { UserUtil } from '../common/utils/user.util';
import { CommonModule } from '../common/common.module';
import { KongOidcAuthStrategy } from './strategies/kong-oidc-auth.strategy';
import { BcscOAuthAuthStrategy } from './strategies/bcsc-oauth-auth.strategy';
import { AuthStrategy } from './strategies/auth-strategy.interface';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    HttpModule,
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    SiebelModule,
    CommonModule,
  ],
  controllers: [AuthController],
  providers: [
    UserService,
    UserUtil,
    AuthService,
    BcscOAuthService,
    KongOidcAuthStrategy,
    BcscOAuthAuthStrategy,
    {
      provide: 'AUTH_STRATEGY',
      useFactory: (
        config: ConfigService,
        kongStrategy: KongOidcAuthStrategy,
        oAuthStrategy: BcscOAuthAuthStrategy,
      ): AuthStrategy => {
        const useKongOidc =
          config.get<string>('USE_KONG_OIDC', 'true') === 'true';
        return useKongOidc ? kongStrategy : oAuthStrategy;
      },
      inject: [ConfigService, KongOidcAuthStrategy, BcscOAuthAuthStrategy],
    },
  ],
  exports: [UserService, AuthService],
})
export class AuthModule {}
