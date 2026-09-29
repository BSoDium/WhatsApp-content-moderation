import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = 'data/test-call-warning-message.test.sqlite';

const { generateCallWarningMessage } = await import('./call-warning-message.ts');

after(() => {
  for (const ext of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${ext}`, { force: true });
});

const INPUT = { recentMessages: ['Salut, tu es là ?'], strikeCount: 1, strikeThreshold: 3 };

function fakeClient(content) {
  return {
    chat: async (request) => ({ message: { content: request.format ? JSON.stringify({ language: 'French' }) : content } }),
  };
}

test('returns the sanitized generated text', async () => {
  const result = await generateCallWarningMessage(INPUT, { client: fakeClient('"Arrêtez d\'appeler."') });

  assert.deepEqual(result, { ok: true, text: "Arrêtez d'appeler." });
});

test('only language detection sees the recent messages; the warning prompt gets the detected language instead', async () => {
  const requests = [];
  const client = {
    chat: async (request) => {
      requests.push(request);
      return { message: { content: request.format ? JSON.stringify({ language: 'French' }) : 'ok' } };
    },
  };

  await generateCallWarningMessage(INPUT, { client });

  const [detection, generation] = requests;
  assert.match(detection.messages[1].content, /Salut, tu es là \?/);
  const generationPrompt = generation.messages.map((m) => m.content).join('\n');
  assert.doesNotMatch(generationPrompt, /Salut, tu es là \?/);
  assert.match(generationPrompt, /Write in French/);
});

test('fails open on an empty response', async () => {
  const result = await generateCallWarningMessage(INPUT, { client: fakeClient('   ') });

  assert.equal(result.ok, false);
});

test('fails open when the client throws', async () => {
  const client = {
    chat: async () => {
      throw new Error('unreachable');
    },
  };

  const result = await generateCallWarningMessage(INPUT, { client });

  assert.equal(result.ok, false);
  assert.match(result.error, /unreachable/);
});

test('fails open when the model refuses instead of writing a warning', async () => {
  const result = await generateCallWarningMessage(INPUT, { client: fakeClient('Je ne peux pas faire cela.') });

  assert.equal(result.ok, false);
});

test('fails open instead of truncating a response longer than WARNING_MAX_LENGTH', async () => {
  const result = await generateCallWarningMessage(INPUT, { client: fakeClient('x'.repeat(501)) });

  assert.equal(result.ok, false);
  assert.match(result.error, /too long/);
});
