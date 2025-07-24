// dev-tools/dev-tools.controller.ts
import {
  Controller,
  Delete,
  Query,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DevToolsService } from './dev-tools.service';
import { ApiTags } from '@nestjs/swagger';
import { DevOnlySwaggerDocs } from '../common/decorators/dev-only-doc.decorator';

@Controller('dev-tools')
@ApiTags('[DevTools]')
export class DevToolsController {
  constructor(
    private readonly devToolsService: DevToolsService,
    private readonly configService: ConfigService,
  ) {}

  @Delete('clear-user-data')
  @DevOnlySwaggerDocs()
  async clearUserData(@Query('userId') userId: string) {
    const isDev = this.configService.get<string>('NODE_ENV') !== 'production';

    if (!isDev) {
      throw new ForbiddenException('Dev tools are disabled');
    }

    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    return this.devToolsService.clearUserData(userId);
  }
}
