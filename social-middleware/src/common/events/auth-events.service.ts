import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

export interface UserLoggedInEvent {
  userId: string;
  bc_services_card_id: string;
  timestamp: Date;
  email: string;
  firstName: string;
  lastName: string;
}

@Injectable()
export class AuthEventsService {
  private eventEmitter = new EventEmitter();
  private activeListeners = new Map<
    string,
    (value: void | PromiseLike<void>) => void
  >();

  async emitUserLoggedInEvent(userData: UserLoggedInEvent): Promise<void> {
    const listenerPromise = new Promise<void>((resolve) => {
      this.activeListeners.set(userData.userId, resolve);
      // Timeout as safety net (optional)
      setTimeout(() => {
        if (this.activeListeners.has(userData.userId)) {
          //this.logger.warn(`User sync timeout for userId: ${userData.userId}`);
          this.completeUserSync(userData.userId);
        }
      }, 10000); // 10 second timeout
    });

    this.eventEmitter.emit('user.loggedIn', userData);
    return listenerPromise;
  }

  completeUserSync(userId: string): void {
    const resolve = this.activeListeners.get(userId);
    if (resolve) {
      resolve();
      this.activeListeners.delete(userId);
    }
  }

  onUserLoggedIn(callback: (userData: UserLoggedInEvent) => void) {
    this.eventEmitter.on('user.loggedIn', callback);
  }

  removeAllListeners() {
    this.eventEmitter.removeAllListeners();
  }
}
