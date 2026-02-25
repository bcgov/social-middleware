import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class TokenBlacklistService implements OnModuleDestroy {
  private readonly redis: Redis;
  constructor(private readonly configService: ConfigService) {
    this.redis = new Redis({
      host: this.configService.get<string>('REDIS_HOST'),
      port: Number(this.configService.get<string>('REDIS_PORT')),
      password: this.configService.get<string>('REDIS_PASSWORD'),
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
    });
  }

  async blacklist(jti: string, expSeconds: number): Promise<void> {
    // Store with TTL matching the token's remaining lifetime
    await this.redis.set(`blacklist:${jti}`, '1', 'EX', expSeconds);
  }

  async isBlacklisted(jti: string): Promise<boolean> {
    const result = await this.redis.get(`blacklist:${jti}`);
    return result !== null;
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
