import { ConfigService } from '@nestjs/config';
import { IncomingMessage, ServerResponse } from 'http';
import { Params } from 'nestjs-pino';
import pino from 'pino';
import { randomUUID } from 'crypto';

export function buildPinoHttpOptions(
  config: ConfigService,
): Params['pinoHttp'] {
  const isProduction = config.get('NODE_ENV') === 'production';

  return {
    level: isProduction ? 'info' : 'debug',
    genReqId: (req: IncomingMessage) =>
      (req.headers['x-request-id'] as string) ?? randomUUID(),
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-userinfo"]',
        'res.headers["set-cookie"]',
        'headers.authorization',
        'headers.cookie',
        'headers["x-userinfo"]',
        'query.code',
        'query.state',
        'err.config.headers.authorization',
        'err.config.auth',
        'err.config.data',
        'err.response.data',
        'error.config.headers.authorization',
        'error.config.auth',
        'error.config.data',
        'error.response.data',
      ],
      censor: '[REDACTED]',
    },
    serializers: {
      req: (req: IncomingMessage) => ({
        id: req.id,
        method: req.method,
        url: req.url,
      }),
      res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
    },
    autoLogging: {
      ignore: (req: IncomingMessage) => req.url === '/health',
    },
    transport: !isProduction
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  };
}
