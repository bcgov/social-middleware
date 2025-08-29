// auth/auth.module.ts

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthController } from './auth.controller';
import { UserService } from './user.service';
import { HttpModule } from '@nestjs/axios';
import { User, UserSchema } from './schemas/user.schema';
import { SiebelModule } from 'src/siebel/siebel.module';

@Module({
  imports: [
    HttpModule,
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    SiebelModule,
  ],
  controllers: [AuthController],
  providers: [UserService],
  exports: [UserService],
})
export class AuthModule {}
