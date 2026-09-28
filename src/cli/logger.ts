import pino from 'pino';
import pinoPretty from 'pino-pretty';

// Per https://no-color.org: "regardless of its value" — presence alone
// disables color, so NO_COLOR='' (however it ends up set) still counts.
// Mirrors terminal-output.ts's own NO_COLOR check.
const NO_COLOR = process.env.NO_COLOR !== undefined;

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
  return pino({ name }, stream);
}
