import { Module } from '@nestjs/common';
import { SessionUtil } from './utils/session.util';
import { UserUtil } from './utils/user.util';
import { AuthEventsService } from './events/auth-events.service';

@Module({
  providers: [SessionUtil, AuthEventsService, UserUtil],
  exports: [SessionUtil, AuthEventsService, UserUtil],
})
export class CommonModule {}
