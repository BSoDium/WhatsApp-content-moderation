import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyMessage } from './classifier.js';

// A fixed policy string is injected in every test below so this suite never
// touches config/policy.md (gitignored — may not exist on a fresh clone or CI).
const POLICY = 'Flag anything that looks like harassment.';

function fakeClient(response) {
  return { chat: async () => response };
}

test('a well-formed response returns ok:true with the parsed fields', async () => {
  const client = fakeClient({
    message: { content: JSON.stringify({ category: 'harassment', reason: 'contains a threat', flagged: true }) },
  });

  const result = await classifyMessage({ message: 'you should be scared' }, { client, policy: POLICY });

  assert.deepEqual(result, { ok: true, flagged: true, category: 'harassment', reason: 'contains a threat' });
});

test('fails open when the client throws (e.g. Ollama unreachable)', async () => {
  const client = { chat: async () => { throw new Error('connect ECONNREFUSED'); } };

  const result = await classifyMessage({ message: 'hey' }, { client, policy: POLICY });

  assert.equal(result.ok, false);
  assert.match(result.error, /ECONNREFUSED/);
});

test('fails open when the response is not valid JSON', async () => {
  const client = fakeClient({ message: { content: 'not json at all' } });

  const result = await classifyMessage({ message: 'hey' }, { client, policy: POLICY });

  assert.equal(result.ok, false);
});

test('fails open when the response is missing required fields', async () => {
  const client = fakeClient({ message: { content: JSON.stringify({ category: 'none' }) } });

  const result = await classifyMessage({ message: 'hey' }, { client, policy: POLICY });

  assert.equal(result.ok, false);
  assert.match(result.error, /malformed classifier response/);
});

test('defaults reason to an empty string when the model omits it', async () => {
  const client = fakeClient({
    message: { content: JSON.stringify({ category: 'none', flagged: false }) },
  });

  const result = await classifyMessage({ message: 'hey' }, { client, policy: POLICY });

  assert.equal(result.ok, true);
  assert.equal(result.reason, '');
});
