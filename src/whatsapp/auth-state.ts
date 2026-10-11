import { mkdir, open, readdir, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';
import type { AuthenticationCreds, AuthenticationState, SignalDataSet, SignalDataTypeMap } from '@whiskeysockets/baileys';
import { createLogger } from '../cli/logger.ts';

const logger = createLogger('auth-state');

const CREDS_FILE = 'creds.json';
const CREDS_BACKUP_FILE = 'creds.json.bak';
const TMP_SUFFIX = '.tmp';
const CORRUPT_SUFFIX = 'corrupt';

export type AuthRecovery = 'none' | 'restored-from-backup' | 'discarded-corrupt';

export interface DurableAuthState {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  recovery: AuthRecovery;
}

type ReadResult = { kind: 'missing' } | { kind: 'ok'; value: unknown } | { kind: 'corrupt'; error: string };

const pathQueues = new Map<string, Promise<void>>();

function serialized<T>(path: string, task: () => Promise<T>): Promise<T> {
  const previous = pathQueues.get(path) ?? Promise.resolve();
  const run = previous.then(task);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  pathQueues.set(path, tail);
  void tail.then(() => {
    if (pathQueues.get(path) === tail) pathQueues.delete(path);
  });
  return run;
}

// Same mapping as Baileys' useMultiFileAuthState, so an existing auth_info/ keeps working untouched.
function fileNameFor(file: string): string {
  return file.replace(/\//g, '__').replace(/:/g, '-');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function syncDirectory(dir: string): Promise<void> {
  try {
    const handle = await open(dir, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Directory fsync isn't supported everywhere (Windows); the file itself was already synced.
  }
}

// Write-to-temp, fsync, rename: a power cut leaves either the whole old file or the whole new one, never a truncated hybrid.
// Callers fsync the directory once per batch via syncDirectory so the rename itself survives too.
async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  const tmpPath = `${filePath}${TMP_SUFFIX}`;
  const handle = await open(tmpPath, 'w');
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmpPath, filePath);
}

async function readJsonFile(filePath: string): Promise<ReadResult> {
  let raw: string;
  try {
    raw = await readFile(filePath, { encoding: 'utf-8' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
    return { kind: 'corrupt', error: errorMessage(err) };
  }
  try {
    return { kind: 'ok', value: JSON.parse(raw, BufferJSON.reviver) };
  } catch (err) {
    return { kind: 'corrupt', error: errorMessage(err) };
  }
}

function isCreds(value: unknown): value is AuthenticationCreds {
  return typeof value === 'object' && value !== null && 'noiseKey' in value && 'signedIdentityKey' in value;
}

async function readCreds(filePath: string): Promise<ReadResult> {
  const result = await readJsonFile(filePath);
  if (result.kind === 'ok' && !isCreds(result.value)) return { kind: 'corrupt', error: 'not a credentials object' };
  return result;
}

async function removeStaleTempFiles(dir: string): Promise<void> {
  const names = await readdir(dir);
  await Promise.all(
    names
      .filter((name) => name.endsWith(TMP_SUFFIX))
      .map((name) => unlink(join(dir, name)).catch(() => undefined)),
  );
}

async function loadCreds(dir: string): Promise<{ creds: AuthenticationCreds; recovery: AuthRecovery }> {
  const credsPath = join(dir, CREDS_FILE);
  const primary = await readCreds(credsPath);
  if (primary.kind === 'ok') return { creds: primary.value as AuthenticationCreds, recovery: 'none' };

  const backup = await readCreds(join(dir, CREDS_BACKUP_FILE));
  if (backup.kind === 'ok') {
    logger.warn(
      { file: CREDS_FILE, state: primary.kind, error: primary.kind === 'corrupt' ? primary.error : undefined },
      'WhatsApp credentials were unreadable (likely an unclean shutdown); restored from the last good backup',
    );
    await writeFileAtomic(credsPath, JSON.stringify(backup.value, BufferJSON.replacer));
    await syncDirectory(dir);
    return { creds: backup.value as AuthenticationCreds, recovery: 'restored-from-backup' };
  }

  if (primary.kind === 'missing') return { creds: initAuthCreds(), recovery: 'none' };

  const quarantinePath = `${credsPath}.${CORRUPT_SUFFIX}-${Date.now()}`;
  await rename(credsPath, quarantinePath);
  logger.error(
    { file: CREDS_FILE, error: primary.error, quarantinedTo: quarantinePath },
    'WhatsApp credentials are corrupt and no backup exists; the device must be linked again',
  );
  return { creds: initAuthCreds(), recovery: 'discarded-corrupt' };
}

/**
 * Drop-in replacement for Baileys' `useMultiFileAuthState` that survives an
 * unclean shutdown. The stock version rewrites files in place and treats any
 * unparseable `creds.json` as "no session", silently minting fresh credentials
 * that then overwrite the real ones — a power cut mid-write turns into a
 * permanent QR-scan loop.
 *
 * Keeps the same on-disk layout. Every write is atomic and fsynced;
 * `creds.json` is mirrored to `creds.json.bak`, which is restored on load if
 * the primary is unreadable. If neither is usable the corrupt file is renamed
 * aside (never deleted) and `recovery` is `'discarded-corrupt'`, so the caller
 * can report that relinking is needed instead of looping.
 */
export async function useDurableAuthState(dir: string): Promise<DurableAuthState> {
  await mkdir(dir, { recursive: true });
  await removeStaleTempFiles(dir);
  const { creds, recovery } = await loadCreds(dir);

  const writeJson = (file: string, data: unknown): Promise<void> => {
    const filePath = join(dir, fileNameFor(file));
    return serialized(filePath, () => writeFileAtomic(filePath, JSON.stringify(data, BufferJSON.replacer)));
  };

  const removeFile = (file: string): Promise<void> => {
    const filePath = join(dir, fileNameFor(file));
    return serialized(filePath, () => unlink(filePath).catch(() => undefined));
  };

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const data: { [id: string]: SignalDataTypeMap[T] } = {};
        await Promise.all(
          ids.map(async (id) => {
            const file = `${type}-${id}.json`;
            const result = await readJsonFile(join(dir, fileNameFor(file)));
            if (result.kind === 'corrupt') logger.warn({ file, error: result.error }, 'key file unreadable; treating as missing');
            let value = result.kind === 'ok' ? result.value : null;
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value as object);
            }
            data[id] = value as SignalDataTypeMap[T];
          }),
        );
        return data;
      },
      set: async (data: SignalDataSet) => {
        const tasks: Promise<void>[] = [];
        for (const category of Object.keys(data) as (keyof SignalDataSet)[]) {
          for (const [id, value] of Object.entries(data[category] ?? {})) {
            const file = `${category}-${id}.json`;
            tasks.push(value ? writeJson(file, value) : removeFile(file));
          }
        }
        await Promise.all(tasks);
        await syncDirectory(dir);
      },
    },
  };

  const saveCreds = async (): Promise<void> => {
    await writeJson(CREDS_FILE, creds);
    await writeJson(CREDS_BACKUP_FILE, creds);
    await syncDirectory(dir);
  };

  return { state, saveCreds, recovery };
}
