import { ConfigService } from '@nestjs/config';

let configService: ConfigService;

export function setConfigService(service: ConfigService) {
  configService = service;
}

export function getConfig(): ConfigService {
  if (!configService) {
    throw new Error('ConfigService has not been initialized.');
  }
  return configService;
}

export function isDev(): boolean {
  return (
    getConfig().get<string>('NODE_ENV') === 'development' ||
    getConfig().get<string>('NODE_ENV') === 'local'
  );
}
