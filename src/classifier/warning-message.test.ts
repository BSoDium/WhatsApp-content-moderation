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

const INPUT = { message: 'you should be scared', strikeCount: 1, strikeThreshold: 3 };

function fakeClient(content, language = 'English') {
  return {
    chat: async (request) => ({ message: { content: request.format ? JSON.stringify({ language }) : content } }),
  };
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

test('truncates sanely at the smallest allowed WARNING_MAX_LENGTH (1), instead of returning almost the full message', async () => {
  setSetting('WARNING_MAX_LENGTH', '1');
  const client = fakeClient('This message is definitely longer than one character.');

  const result = await generateWarningMessage(INPUT, { client });

  assert.equal(result.ok, true);
  assert.equal(result.text, '…');

  setSetting('WARNING_MAX_LENGTH', '20'); // restore for any test appended after this one
});

test('the warning model is never shown the flagged message, only its detected language', async () => {
  const requests = [];
  const client = {
    chat: async (request) => {
      requests.push(request);
      return { message: { content: request.format ? JSON.stringify({ language: 'French' }) : 'Stop.' } };
    },
  };

  await generateWarningMessage({ ...INPUT, message: 'phrase secrète du contact' }, { client });

  const [detection, generation] = requests;
  assert.match(detection.messages[1].content, /phrase secrète du contact/);
  const generationPrompt = generation.messages.map((m) => m.content).join('\n');
  assert.doesNotMatch(generationPrompt, /phrase secrète du contact/);
  assert.match(generationPrompt, /Write in French/);
});

test('fails open when the language cannot be detected', async () => {
  const client = { chat: async () => ({ message: { content: 'not json' } }) };

  const result = await generateWarningMessage(INPUT, { client });

  assert.equal(result.ok, false);
  assert.match(result.error, /language detection failed/);
});

test('fails open when the model refuses instead of writing a warning', async () => {
  const client = fakeClient("I can't fulfill this request.");

  const result = await generateWarningMessage(INPUT, { client });

  assert.equal(result.ok, false);
  assert.match(result.error, /refused/);
});
