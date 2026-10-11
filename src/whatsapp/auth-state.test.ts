import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initAuthCreds } from '@whiskeysockets/baileys';
import { useDurableAuthState } from './auth-state.ts';

async function withDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'auth-state-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('a first run starts from fresh credentials with no recovery', async () => {
  await withDir(async (dir) => {
    const { state, recovery } = await useDurableAuthState(dir);
    assert.equal(recovery, 'none');
    assert.equal(state.creds.me, undefined);
  });
});

test('saved credentials are loaded back on the next start', async () => {
  await withDir(async (dir) => {
    const first = await useDurableAuthState(dir);
    first.state.creds.me = { id: '33600000000:1@s.whatsapp.net', name: 'Test' };
    await first.saveCreds();

    const second = await useDurableAuthState(dir);
    assert.equal(second.recovery, 'none');
    assert.equal(second.state.creds.me?.id, '33600000000:1@s.whatsapp.net');
    assert.deepEqual(second.state.creds.noiseKey.private, first.state.creds.noiseKey.private);
  });
});

test('a truncated creds.json is restored from the backup instead of minting a new session', async () => {
  await withDir(async (dir) => {
    const first = await useDurableAuthState(dir);
    first.state.creds.me = { id: '33600000000:1@s.whatsapp.net', name: 'Test' };
    await first.saveCreds();
    await writeFile(join(dir, 'creds.json'), '{"noiseKey":{"private":{"type":"Buff');

    const second = await useDurableAuthState(dir);
    assert.equal(second.recovery, 'restored-from-backup');
    assert.equal(second.state.creds.me?.id, '33600000000:1@s.whatsapp.net');

    const healed = JSON.parse(await readFile(join(dir, 'creds.json'), 'utf-8'));
    assert.ok(healed.noiseKey);
  });
});

test('an empty creds.json (a zero-length file after power loss) is restored from the backup', async () => {
  await withDir(async (dir) => {
    const first = await useDurableAuthState(dir);
    first.state.creds.me = { id: '33600000000:1@s.whatsapp.net', name: 'Test' };
    await first.saveCreds();
    await writeFile(join(dir, 'creds.json'), '');

    const second = await useDurableAuthState(dir);
    assert.equal(second.recovery, 'restored-from-backup');
    assert.equal(second.state.creds.me?.id, '33600000000:1@s.whatsapp.net');
  });
});

test('a missing creds.json is restored from the backup', async () => {
  await withDir(async (dir) => {
    const first = await useDurableAuthState(dir);
    first.state.creds.me = { id: '33600000000:1@s.whatsapp.net', name: 'Test' };
    await first.saveCreds();
    await rm(join(dir, 'creds.json'));

    const second = await useDurableAuthState(dir);
    assert.equal(second.recovery, 'restored-from-backup');
    assert.equal(second.state.creds.me?.id, '33600000000:1@s.whatsapp.net');
  });
});

test('corrupt creds with no backup are set aside, not deleted, and reported', async () => {
  await withDir(async (dir) => {
    await writeFile(join(dir, 'creds.json'), '{"noiseKey":');

    const { state, recovery } = await useDurableAuthState(dir);
    assert.equal(recovery, 'discarded-corrupt');
    assert.equal(state.creds.me, undefined);

    const names = await readdir(dir);
    assert.ok(names.some((name) => name.startsWith('creds.json.corrupt-')));
    assert.ok(!names.includes('creds.json'));
  });
});

test('valid JSON that is not credentials counts as corrupt', async () => {
  await withDir(async (dir) => {
    await writeFile(join(dir, 'creds.json'), '{}');
    const { recovery } = await useDurableAuthState(dir);
    assert.equal(recovery, 'discarded-corrupt');
  });
});

test('leftover temp files from an interrupted write are cleaned up and never read', async () => {
  await withDir(async (dir) => {
    const first = await useDurableAuthState(dir);
    await first.saveCreds();
    await writeFile(join(dir, 'creds.json.tmp'), '{"half-writt');
    await writeFile(join(dir, 'session-abc.json.tmp'), '{');

    const second = await useDurableAuthState(dir);
    assert.equal(second.recovery, 'none');
    const names = await readdir(dir);
    assert.ok(!names.some((name) => name.endsWith('.tmp')));
  });
});

test('keys round-trip, and a null value removes the key', async () => {
  await withDir(async (dir) => {
    const { state } = await useDurableAuthState(dir);
    await state.keys.set({ 'lid-mapping': { '123': '456@lid' }, 'device-list': { a: ['1', '2'] } });

    assert.deepEqual(await state.keys.get('lid-mapping', ['123']), { '123': '456@lid' });
    assert.deepEqual(await state.keys.get('device-list', ['a']), { a: ['1', '2'] });

    await state.keys.set({ 'lid-mapping': { '123': null } });
    assert.deepEqual(await state.keys.get('lid-mapping', ['123']), { '123': null });
  });
});

test('an unreadable key file reads as missing instead of throwing', async () => {
  await withDir(async (dir) => {
    const { state } = await useDurableAuthState(dir);
    await writeFile(join(dir, 'lid-mapping-123.json'), '"456@l');
    assert.deepEqual(await state.keys.get('lid-mapping', ['123']), { '123': null });
  });
});

test('key ids containing slashes and colons map to the same file names as Baileys', async () => {
  await withDir(async (dir) => {
    const { state } = await useDurableAuthState(dir);
    await state.keys.set({ session: { 'a/b:c': new Uint8Array([1, 2, 3]) } });
    assert.ok((await readdir(dir)).includes('session-a__b-c.json'));
  });
});

test('concurrent credential saves settle on the last one written', async () => {
  await withDir(async (dir) => {
    const { state, saveCreds } = await useDurableAuthState(dir);
    state.creds.me = { id: 'first@s.whatsapp.net', name: 'a' };
    const first = saveCreds();
    state.creds.me = { id: 'second@s.whatsapp.net', name: 'b' };
    const second = saveCreds();
    await Promise.all([first, second]);

    const reloaded = await useDurableAuthState(dir);
    assert.equal(reloaded.state.creds.me?.id, 'second@s.whatsapp.net');
  });
});

test('fresh credentials from initAuthCreds satisfy the credentials check', async () => {
  await withDir(async (dir) => {
    await writeFile(join(dir, 'creds.json'), JSON.stringify(initAuthCreds()));
    const { recovery } = await useDurableAuthState(dir);
    assert.equal(recovery, 'none');
  });
});
