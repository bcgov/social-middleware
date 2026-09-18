import pino from 'pino';

export function createTestLogger(pinoOptions: pino.LoggerOptions) {
  const lines: string[] = [];
  const stream = {
    write: (chunk: string) => {
      lines.push(chunk);
      return true;
    },
  };
  const logger = pino(pinoOptions, stream);
  return {
    logger,
    lines,
    getLogs: (): Record<string, unknown>[] =>
      lines.map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}
