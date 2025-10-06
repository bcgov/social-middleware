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

  emitUserLoggedInEvent(userData: UserLoggedInEvent) {
    this.eventEmitter.emit('user.loggedIn', userData);
  }

  onUserLoggedIn(callback: (userData: UserLoggedInEvent) => void) {
    this.eventEmitter.on('user.loggedIn', callback);
  }

  removeAllListeners() {
    this.eventEmitter.removeAllListeners();
  }
}
