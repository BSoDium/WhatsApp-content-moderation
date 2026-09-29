import { readFileSync } from 'node:fs';
import { createLogger } from './cli/logger.ts';

const logger = createLogger('version');

const UNKNOWN_VERSION = 'unknown';

function readVersion(): string {
  try {
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return typeof version === 'string' ? version : UNKNOWN_VERSION;
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'could not read app version from package.json');
    return UNKNOWN_VERSION;
  }
}

export const APP_VERSION = readVersion();
