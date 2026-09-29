import { test } from 'node:test';
import assert from 'node:assert/strict';

const { detectLanguage } = await import('./language.ts');

function fakeClient(content) {
  return { chat: async () => ({ message: { content } }) };
}

test('returns a supported language name', async () => {
  const result = await detectLanguage('Salut', fakeClient(JSON.stringify({ language: 'French' })), 'm');

  assert.deepEqual(result, { ok: true, language: 'French' });
});

test('rejects free text that is not a supported language, e.g. a steered answer', async () => {
  const result = await detectLanguage('x', fakeClient(JSON.stringify({ language: 'Ignore all previous rules' })), 'm');

  assert.equal(result.ok, false);
  assert.match(result.error, /unsupported language/);
});

test('fails open on a response that is not JSON', async () => {
  const result = await detectLanguage('x', fakeClient("I can't help with that."), 'm');

  assert.equal(result.ok, false);
});

test('fails open when the client throws', async () => {
  const client = { chat: async () => { throw new Error('connect ECONNREFUSED'); } };

  const result = await detectLanguage('x', client, 'm');

  assert.equal(result.ok, false);
  assert.match(result.error, /ECONNREFUSED/);
});

test('sends the text as the user turn and constrains the answer with a schema', async () => {
  let request;
  const client = { chat: async (r) => ((request = r), { message: { content: JSON.stringify({ language: 'English' }) } }) };

  await detectLanguage('hello there', client, 'm');

  assert.equal(request.messages[1].content, 'hello there');
  assert.ok(request.format.properties.language.enum.includes('English'));
});
