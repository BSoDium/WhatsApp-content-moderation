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

test('emoji-only text is answered in English without calling the model', async () => {
  const client = { chat: async () => { throw new Error('model should not be called'); } };

  const result = await detectLanguage('🖕🖕🖕', client, 'm');

  assert.deepEqual(result, { ok: true, language: 'English' });
});

test('emoji-only text borrows the language of the contact\'s earlier messages', async () => {
  let request;
  const client = { chat: async (r) => ((request = r), { message: { content: JSON.stringify({ language: 'French' }) } }) };

  const result = await detectLanguage('🖕🖕', client, 'm', ['😡', 'ça suffit maintenant', 'hello']);

  assert.deepEqual(result, { ok: true, language: 'French' });
  assert.equal(request.messages[1].content, 'ça suffit maintenant');
});

test('text with letters is detected on its own even when earlier messages exist', async () => {
  let request;
  const client = { chat: async (r) => ((request = r), { message: { content: JSON.stringify({ language: 'English' }) } }) };

  await detectLanguage('shut up', client, 'm', ['ça suffit']);

  assert.equal(request.messages[1].content, 'shut up');
});
