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
  return { chat: async (request) => ({ message: { content }, request }) };
}

test('returns the sanitized generated text', async () => {
  const result = await generateCallWarningMessage(INPUT, { client: fakeClient('"Arrêtez d\'appeler."') });

  assert.deepEqual(result, { ok: true, text: "Arrêtez d'appeler." });
});

test('includes the recent messages in the prompt so the model can match their language', async () => {
  let prompt = '';
  const client = { chat: async (request) => ((prompt = request.messages[1].content), { message: { content: 'ok' } }) };

  await generateCallWarningMessage(INPUT, { client });

  assert.match(prompt, /Salut, tu es là \?/);
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

  assert.deepEqual(await generateCallWarningMessage(INPUT, { client }), { ok: false, error: 'unreachable' });
});
