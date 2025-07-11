//AuthModule

import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { HttpModule} from '@nestjs/axios';

@Module({
  imports: [HttpModule],
  controllers: [AuthController],
})
export class AuthModule {}