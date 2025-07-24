import { Controller, Delete, Query, BadRequestException } from '@nestjs/common';
import { DevToolsService } from './dev-tools.service';
import { ApiTags } from '@nestjs/swagger';
import { DevOnlySwaggerDocs } from '../common/decorators/dev-only-doc.decorator';
import { isDev } from '../common/config/config-loader';

@Controller('dev-tools')
@ApiTags('[DevTools]')
export class DevToolsController {
  constructor(private readonly devToolsService: DevToolsService) {}

  @Delete('clear-user-data')
  @DevOnlySwaggerDocs()
  async clearUserData(@Query('userId') userId: string) {
    if (!isDev()) {
      throw new BadRequestException('Dev tools are disabled');
    }

    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    return this.devToolsService.clearUserData(userId);
  }
}
