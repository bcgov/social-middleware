import {
  Controller,
  Delete,
  Query,
  BadRequestException,
  ForbiddenException,
  ValidationPipe,
} from '@nestjs/common';
import { DevToolsService } from './dev-tools.service';
import { ApiTags } from '@nestjs/swagger';
import { DevOnlySwaggerDocs } from '../common/decorators/dev-only-doc.decorator';
import { DevOnlyResetPackageDocs } from '../common/decorators/dev-only-reset-package-doc.decorator';
import { isDev } from '../common/config/config-loader';
import { ClearUserDataQueryDto } from './dto/clear-user-data-query.dto';
import { ResetApplicationPackageQueryDto } from './dto/reset-application-package-query.dto';

@Controller('dev-tools')
@ApiTags('[DevTools]')
export class DevToolsController {
  constructor(private readonly devToolsService: DevToolsService) {}

  @Delete('clear-user-data')
  @DevOnlySwaggerDocs()
  async clearUserData(
    @Query(new ValidationPipe({ whitelist: true, transform: true }))
    query: ClearUserDataQueryDto,
  ) {
    if (!isDev) {
      throw new ForbiddenException('Dev tools are disabled');
    }

    if (!query.userId) {
      throw new BadRequestException('userId is required');
    }

    return this.devToolsService.clearUserData(query.userId);
  }

  @Delete('reset-application-package')
  @DevOnlyResetPackageDocs()
  async resetApplicationPackage(
    @Query(new ValidationPipe({ whitelist: true, transform: true }))
    query: ResetApplicationPackageQueryDto,
  ) {
    if (!isDev) {
      throw new ForbiddenException('Dev tools are disabled');
    }

    if (!query.applicationPackageId) {
      throw new BadRequestException('applicationPackageId is required');
    }

    return await this.devToolsService.resetApplicationPackage(
      query.applicationPackageId,
    );
  }
}
