// auth/auth.module.ts

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserService } from './user.service';
import { HttpModule } from '@nestjs/axios';
import { User, UserSchema } from './schemas/user.schema';
import { SiebelModule } from 'src/siebel/siebel.module';
import { UserUtil } from '../common/utils/user.util';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [
    HttpModule,
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    SiebelModule,
    CommonModule,
  ],
  controllers: [AuthController],
  providers: [UserService, UserUtil, AuthService],
  exports: [UserService, AuthService],
})
export class AuthModule {}
