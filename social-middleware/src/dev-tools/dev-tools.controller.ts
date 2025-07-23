import { Controller, Delete, Query, BadRequestException } from '@nestjs/common';
import { DevToolsService } from './dev-tools.service';
import { ApiTags } from '@nestjs/swagger';
import { DevOnlySwaggerDocs } from '../common/decorators/dev-only-doc.decorator';

@Controller('dev-tools')
@ApiTags('[DevTools]')
export class DevToolsController {
  constructor(private readonly devToolsService: DevToolsService) {}

  @Delete('clear-user-data')
  @DevOnlySwaggerDocs()
  async clearUserData(@Query('userId') userId: string) {
    const isEnabled = process.env.ENABLE_DEV_TOOLS === 'true';

    if (!isEnabled) {
      throw new BadRequestException('Dev tools are disabled');
    }

    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    return this.devToolsService.clearUserData(userId);
  }
}
