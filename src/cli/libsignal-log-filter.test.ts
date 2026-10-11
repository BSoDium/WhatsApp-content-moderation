import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installLibsignalLogFilter } from './libsignal-log-filter.ts';

class SessionEntry {
  currentRatchet = { ephemeralKeyPair: { privKey: Buffer.from('secret') }, rootKey: Buffer.from('root') };
  indexInfo = { baseKey: Buffer.from('base'), closed: -1 };
}

function fakeConsole() {
  const seen: Array<{ method: string; args: unknown[] }> = [];
  const record = (method: string) => (...args: unknown[]) => {
    seen.push({ method, args });
  };
  return {
    target: { log: record('log'), info: record('info'), warn: record('warn'), error: record('error'), debug: record('debug') },
    seen,
  };
}

test('drops the libsignal session lifecycle messages', () => {
  const { target, seen } = fakeConsole();
  installLibsignalLogFilter(target);
  target.info('Closing session:', new SessionEntry());
  target.info('Opening session:', new SessionEntry());
  target.info('Removing old closed session:', new SessionEntry());
  target.warn('Session already closed', new SessionEntry());
  assert.deepEqual(seen, []);
});

test('drops any call carrying a SessionEntry, whatever the message says', () => {
  const { target, seen } = fakeConsole();
  installLibsignalLogFilter(target);
  target.log('something new', new SessionEntry());
  target.error({ nested: 1 }, new SessionEntry());
  assert.deepEqual(seen, []);
});

test('drops a structurally identical session dump even if the class is renamed', () => {
  const { target, seen } = fakeConsole();
  installLibsignalLogFilter(target);
  target.info('x', { currentRatchet: {}, indexInfo: {} });
  assert.deepEqual(seen, []);
});

test('passes the app and unrelated library logs through untouched', () => {
  const { target, seen } = fakeConsole();
  installLibsignalLogFilter(target);
  const err = new Error('boom');
  target.log('[qr] also saved to ./auth_info/login-qr.png');
  target.error('Reconnect failed:', err);
  target.warn('Decrypted message with closed session.');
  target.info('Closing the control server', { port: 4756 });
  assert.deepEqual(seen, [
    { method: 'log', args: ['[qr] also saved to ./auth_info/login-qr.png'] },
    { method: 'error', args: ['Reconnect failed:', err] },
    { method: 'warn', args: ['Decrypted message with closed session.'] },
    { method: 'info', args: ['Closing the control server', { port: 4756 }] },
  ]);
});

test('the returned function restores the original methods', () => {
  const { target, seen } = fakeConsole();
  const originalInfo = target.info;
  const restore = installLibsignalLogFilter(target);
  assert.notEqual(target.info, originalInfo);
  restore();
  assert.equal(target.info, originalInfo);
  target.info('Closing session:', new SessionEntry());
  assert.equal(seen.length, 1);
});
