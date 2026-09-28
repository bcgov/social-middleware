import { ConfigService } from '@nestjs/config';
import type { LoggerOptions as PinoLoggerOptions } from 'pino';
import { buildPinoHttpOptions } from './pino-options';
import { createTestLogger } from './pino-test-stream';

const MARKER = 'SYNTH_SECRET_MARKER';

function buildCoreOptions(nodeEnv: 'production' | 'development') {
  const config = {
    get: (key: string) => (key === 'NODE_ENV' ? nodeEnv : undefined),
  } as unknown as ConfigService;

  // genReqId/autoLogging/transport are pino-http-only concerns (request
  // correlation + dev pretty-printing); transport also can't coexist with
  // a custom destination stream. Redaction/serializers/level are the actual
  // security-relevant surface and are plain pino.LoggerOptions.
  const core = { ...buildPinoHttpOptions(config)! } as Record<string, unknown>;
  delete core.genReqId;
  delete core.autoLogging;
  delete core.transport;
  return core as PinoLoggerOptions;
}

function emitAtEveryRedactPath(
  logger: ReturnType<typeof createTestLogger>['logger'],
  level: 'info' | 'debug',
) {
  logger[level](
    {
      headers: { authorization: MARKER, cookie: MARKER, 'x-userinfo': MARKER },
    },
    'flat headers',
  );
  logger[level](
    {
      req: {
        headers: {
          authorization: MARKER,
          cookie: MARKER,
          'x-userinfo': MARKER,
        },
      },
    },
    'req headers',
  );
  logger[level]({ res: { headers: { 'set-cookie': MARKER } } }, 'res headers');
  logger[level](
    { query: { code: MARKER, state: MARKER } },
    'oauth query params',
  );

  const axiosLikeError = Object.assign(new Error('boom'), {
    config: {
      auth: { username: 'svc-account', password: MARKER },
      data: MARKER,
      headers: { authorization: MARKER },
    },
    response: { data: MARKER },
  });
  logger[level]({ err: axiosLikeError }, 'err key');
  logger[level]({ error: axiosLikeError }, 'error key');
}

describe('buildPinoHttpOptions redaction', () => {
  it.each([['production', 'info'] as const, ['development', 'debug'] as const])(
    'never serializes sensitive fields at the %s level (%s)',
    (nodeEnv, level) => {
      const { logger, getLogs } = createTestLogger(buildCoreOptions(nodeEnv));

      emitAtEveryRedactPath(logger, level);

      const serialized = JSON.stringify(getLogs());
      expect(serialized).not.toContain(MARKER);
      expect(getLogs().length).toBeGreaterThan(0); // sanity: lines were actually captured
    },
  );
});
