const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;

const SESSION_LOG_PREFIXES = [
  'Closing session:',
  'Opening session:',
  'Removing old closed session:',
  'Session already closed',
];

const SESSION_ENTRY_CLASS_NAME = 'SessionEntry';

type ConsoleMethod = (...args: unknown[]) => void;
type FilterableConsole = Record<(typeof CONSOLE_METHODS)[number], ConsoleMethod>;

function isSessionDump(arg: unknown): boolean {
  if (typeof arg !== 'object' || arg === null) return false;
  if (arg.constructor?.name === SESSION_ENTRY_CLASS_NAME) return true;
  return 'currentRatchet' in arg && 'indexInfo' in arg;
}

function shouldDrop(args: unknown[]): boolean {
  const [first] = args;
  if (typeof first === 'string' && SESSION_LOG_PREFIXES.some((prefix) => first.startsWith(prefix))) return true;
  return args.some(isSessionDump);
}

/**
 * Drops console calls that carry a libsignal `SessionEntry`, and returns a
 * function that restores the original methods.
 *
 * libsignal logs whole session records straight to `console.info`/`warn` when
 * it closes, opens or prunes a session, ratchet private key and root key
 * included. Baileys' `logger` option never sees these calls, so without this
 * they land in `docker compose logs`, which is far less protected than
 * `auth_info/`. Every other console call passes through untouched; the app's
 * own pino output writes to the stream directly and never reaches `console`.
 */
export function installLibsignalLogFilter(target: FilterableConsole = console): () => void {
  const originals = CONSOLE_METHODS.map((method) => [method, target[method]] as const);

  for (const [method, original] of originals) {
    target[method] = (...args: unknown[]) => {
      if (!shouldDrop(args)) original.apply(target, args);
    };
  }

  return () => {
    for (const [method, original] of originals) target[method] = original;
  };
}
