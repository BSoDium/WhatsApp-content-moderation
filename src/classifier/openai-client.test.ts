import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

const { createOpenAiClient } = await import('./openai-client.ts');

interface Seen {
  method?: string;
  url?: string;
  authorization?: string;
  body: Record<string, unknown>;
}

type Responder = (seen: Seen, res: ServerResponse) => void;

const seen: Seen[] = [];
let responder: Responder = () => {};

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString();
    const entry: Seen = { method: req.method, url: req.url, authorization: req.headers.authorization, body: raw ? JSON.parse(raw) : {} };
    seen.push(entry);
    responder(entry, res);
  });
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address() as { port: number };
const BASE = `http://127.0.0.1:${port}/v1/`;

after(() => server.close());

function reply(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function client(overrides = {}) {
  seen.length = 0;
  return createOpenAiClient({ baseUrl: BASE, apiKey: 'sk-test', timeoutMs: 2000, ...overrides });
}

const SCHEMA = { type: 'object', properties: { flagged: { type: 'boolean' } }, required: ['flagged'] };

test('posts the chat to /chat/completions with the key, mapped options and a JSON schema', async () => {
  responder = (_seen, res) => reply(res, 200, { choices: [{ message: { content: '{"flagged":false}' }, finish_reason: 'stop' }] });

  const result = await client().chat({
    model: 'm',
    messages: [{ role: 'user', content: 'hi' }],
    format: SCHEMA,
    options: { temperature: 0.2, num_predict: 50, repeat_penalty: 1.1 },
  });

  assert.deepEqual(result, { message: { content: '{"flagged":false}' } });
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].url, '/v1/chat/completions');
  assert.equal(seen[0].authorization, 'Bearer sk-test');
  assert.deepEqual(seen[0].body, {
    model: 'm',
    messages: [{ role: 'user', content: 'hi' }],
    stream: false,
    temperature: 0.2,
    max_tokens: 50,
    response_format: { type: 'json_schema', json_schema: { name: 'response', strict: false, schema: SCHEMA } },
  });
});

test('sends no Authorization header and no response_format when there is no key or schema', async () => {
  responder = (_seen, res) => reply(res, 200, { choices: [{ message: { content: 'hello' } }] });

  await client({ apiKey: '' }).chat({ model: 'm', messages: [] });

  assert.equal(seen[0].authorization, undefined);
  assert.equal('response_format' in seen[0].body, false);
});

test('a reply cut off at the token limit is reported as done_reason length', async () => {
  responder = (_seen, res) => reply(res, 200, { choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] });

  const result = await client().chat({ model: 'm', messages: [] });

  assert.equal(result.done_reason, 'length');
});

test('retries in plain JSON mode, with the schema in the prompt, when the server rejects json_schema', async () => {
  responder = (entry, res) => {
    const format = entry.body.response_format as { type: string };
    if (format.type === 'json_schema') return reply(res, 400, { error: 'unsupported response_format' });
    reply(res, 200, { choices: [{ message: { content: '{"flagged":true}' } }] });
  };

  const result = await client().chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }], format: SCHEMA });

  assert.equal(result.message.content, '{"flagged":true}');
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[1].body.response_format, { type: 'json_object' });
  const messages = seen[1].body.messages as { role: string; content: string }[];
  assert.match(messages.at(-1)?.content ?? '', /JSON schema/);
});

test('a non-2xx status throws with a short preview of the body', async () => {
  responder = (_seen, res) => reply(res, 401, { error: 'bad key' });

  await assert.rejects(client().chat({ model: 'm', messages: [] }), /returned 401.*bad key/);
});

test('a reply with no message content throws', async () => {
  responder = (_seen, res) => reply(res, 200, { choices: [] });

  await assert.rejects(client().chat({ model: 'm', messages: [] }), /no message content/);
});

test('an unset base URL throws before any request is made', async () => {
  await assert.rejects(client({ baseUrl: '  ' }).chat({ model: 'm', messages: [] }), /base URL is not set/);
  assert.equal(seen.length, 0);
});

test('a request that exceeds the timeout fails', async () => {
  responder = () => {};

  await assert.rejects(client({ timeoutMs: 50 }).chat({ model: 'm', messages: [] }));
});

test('listModels returns the ids from /models without sizes', async () => {
  responder = (_seen, res) => reply(res, 200, { data: [{ id: 'gpt-x' }, { id: 'llama' }, { nope: 1 }] });

  const models = await client().listModels();

  assert.equal(seen[0].method, 'GET');
  assert.equal(seen[0].url, '/v1/models');
  assert.deepEqual(models, [{ name: 'gpt-x', sizeBytes: null }, { name: 'llama', sizeBytes: null }]);
});
