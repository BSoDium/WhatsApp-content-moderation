import pino from 'pino';
import pinoPretty from 'pino-pretty';
import { NO_COLOR } from './terminal-output.ts';

// Lets an operator raise verbosity (e.g. 'debug') on a running deployment
// without rebuilding the image — mirrors classifier.ts's env-driven knobs.
const DEFAULT_LOG_LEVEL = 'info';
const LOG_LEVEL = process.env.LOG_LEVEL?.trim() || DEFAULT_LOG_LEVEL;

// A stream built directly from pino-pretty, not a `transport: { target:
// 'pino-pretty' }` config — the latter resolves its target as a worker-thread
// module path, which this project's "run TypeScript directly via Node's
// built-in stripping" setup (see README "Development") can't reliably do for
// a package under node_modules. Piping through the stream form avoids the
// worker thread entirely.
const stream = pinoPretty({
  colorize: !NO_COLOR,
  translateTime: 'SYS:HH:MM:ss',
  ignore: 'pid,hostname',
  singleLine: true,
});

export function createLogger(name: string) {
  return pino({ name, level: LOG_LEVEL }, stream);
}
