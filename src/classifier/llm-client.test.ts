import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = 'data/test-llm-client.test.sqlite';

const { createLlmClient } = await import('./llm-client.ts');
const { setSetting } = await import('../store/settings.ts');

after(() => {
  for (const ext of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${ext}`, { force: true });
});

test('the openai provider fails fast, with no network call, when no base URL is configured', async () => {
  setSetting('LLM_PROVIDER', 'openai');
  setSetting('LLM_BASE_URL', '');

  await assert.rejects(createLlmClient(1000).chat({ model: 'm', messages: [] }), /base URL is not set/);
});

test('the openai provider is chosen from the setting on every call', async () => {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    setSetting('LLM_PROVIDER', 'openai');
    setSetting('LLM_BASE_URL', 'https://llm.example/v1');
    const result = await createLlmClient(1000).chat({ model: 'm', messages: [] });

    assert.equal(result.message.content, 'ok');
    assert.deepEqual(calls, ['https://llm.example/v1/chat/completions']);
  } finally {
    globalThis.fetch = realFetch;
  }
});
