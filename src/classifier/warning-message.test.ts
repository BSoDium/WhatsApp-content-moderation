import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = 'data/test-warning-message.test.sqlite';

const { setSetting } = await import('../store/settings.ts');
const { generateWarningMessage } = await import('./warning-message.ts');

setSetting('WARNING_MAX_LENGTH', '20');

after(() => {
  for (const ext of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${ext}`, { force: true });
});

const INPUT = { message: 'you should be scared', category: 'harassment', reason: 'contains a threat', strikeCount: 1, strikeThreshold: 3 };

function fakeClient(content) {
  return { chat: async () => ({ message: { content } }) };
}

test('returns ok:true with the sanitized message text', async () => {
  const client = fakeClient('Stop sending threats or you will be blocked by this automated system.');

  const result = await generateWarningMessage(INPUT, { client });

  assert.equal(result.ok, true);
  assert.equal(result.text.length <= 20, true);
});

test('strips surrounding quotes and collapses whitespace/newlines', async () => {
  const client = fakeClient('"Stop\n\n  that   right now."');

  const result = await generateWarningMessage({ ...INPUT, strikeCount: 1 }, { client });

  assert.equal(result.ok, true);
  assert.equal(result.text.startsWith('"'), false);
  assert.equal(result.text.includes('\n'), false);
  assert.equal(result.text.includes('  '), false);
});

test('truncates a response longer than WARNING_MAX_LENGTH', async () => {
  const client = fakeClient('This is a much longer automated warning message than the configured maximum length allows for.');

  const result = await generateWarningMessage(INPUT, { client });

  assert.equal(result.ok, true);
  assert.equal(result.text.length, 20);
  assert.equal(result.text.endsWith('…'), true);
});

test('fails open when the client throws (e.g. Ollama unreachable)', async () => {
  const client = { chat: async () => { throw new Error('connect ECONNREFUSED'); } };

  const result = await generateWarningMessage(INPUT, { client });

  assert.equal(result.ok, false);
  assert.match(result.error, /ECONNREFUSED/);
});

test('fails open when the response is empty after sanitizing', async () => {
  const client = fakeClient('   \n\n  ');

  const result = await generateWarningMessage(INPUT, { client });

  assert.equal(result.ok, false);
  assert.match(result.error, /empty warning message/);
});
