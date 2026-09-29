import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = 'data/test-warning-message.test.sqlite';

const { setSetting } = await import('../store/settings.ts');
const { generateWarningMessage } = await import('./warning-message.ts');

setSetting('WARNING_MAX_LENGTH', '80');

after(() => {
  for (const ext of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${ext}`, { force: true });
});

const INPUT = { message: 'you should be scared', strikeCount: 1, strikeThreshold: 3 };

function fakeClient(content, language = 'Swahili') {
  return {
    chat: async (request) => ({ message: { content: request.format ? JSON.stringify({ language }) : content } }),
  };
}

test('returns ok:true with the sanitized message text', async () => {
  const client = fakeClient('Stop sending threats or you will be blocked by this automated system.');

  const result = await generateWarningMessage(INPUT, { client });

  assert.deepEqual(result, { ok: true, text: 'Stop sending threats or you will be blocked by this automated system.' });
});

test('strips surrounding quotes and collapses whitespace/newlines', async () => {
  const client = fakeClient('"Stop\n\n  that   right now."');

  const result = await generateWarningMessage({ ...INPUT, strikeCount: 1 }, { client });

  assert.equal(result.ok, true);
  assert.equal(result.text.startsWith('"'), false);
  assert.equal(result.text.includes('\n'), false);
  assert.equal(result.text.includes('  '), false);
});

test('never truncates: a response longer than WARNING_MAX_LENGTH fails open to the static fallback', async () => {
  const client = fakeClient('This is a much longer automated warning message than the configured maximum length of eighty characters allows for.');

  const result = await generateWarningMessage(INPUT, { client });

  assert.equal(result.ok, false);
  assert.match(result.error, /too long/);
});

test('sends a response exactly at WARNING_MAX_LENGTH in full', async () => {
  const text = 'x'.repeat(80);

  const result = await generateWarningMessage(INPUT, { client: fakeClient(text) });

  assert.deepEqual(result, { ok: true, text });
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

test('the warning model is never shown the flagged message, only its detected language', async () => {
  const requests = [];
  const client = {
    chat: async (request) => {
      requests.push(request);
      return { message: { content: request.format ? JSON.stringify({ language: 'Swahili' }) : 'Stop.' } };
    },
  };

  await generateWarningMessage({ ...INPUT, message: 'phrase secrète du contact' }, { client });

  const [detection, generation] = requests;
  assert.match(detection.messages[1].content, /phrase secrète du contact/);
  const generationPrompt = generation.messages.map((m) => m.content).join('\n');
  assert.doesNotMatch(generationPrompt, /phrase secrète du contact/);
  assert.match(generationPrompt, /Write in Swahili/);
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

test('also treats a refusal written with a typographic apostrophe as a refusal', async () => {
  const client = fakeClient('I can’t write a message that uses insulting language.');

  const result = await generateWarningMessage(INPUT, { client });

  assert.equal(result.ok, false);
});

function scriptedClient(replies) {
  const generations = [];
  const client = {
    chat: async (request) => {
      if (request.format) return { message: { content: JSON.stringify({ language: 'Swahili' }) } };
      generations.push(request);
      return { message: { content: replies[Math.min(generations.length - 1, replies.length - 1)] } };
    },
  };
  return { client, generations };
}

test('retries once with a shorter-reply instruction when the first attempt is too long', async () => {
  const { client, generations } = scriptedClient(['x'.repeat(81), 'Short and complete.']);

  const result = await generateWarningMessage(INPUT, { client });

  assert.deepEqual(result, { ok: true, text: 'Short and complete.' });
  assert.equal(generations.length, 2);
  assert.doesNotMatch(generations[0].messages[1].content, /too long/);
  assert.match(generations[1].messages[1].content, /too long.*at most 48 characters/);
});

test('gives up after two attempts and reports the last failure', async () => {
  const { client, generations } = scriptedClient(['x'.repeat(81)]);

  const result = await generateWarningMessage(INPUT, { client });

  assert.equal(result.ok, false);
  assert.match(result.error, /too long/);
  assert.equal(generations.length, 2);
});

test('does not retry when the model call itself fails', async () => {
  let generations = 0;
  const client = {
    chat: async (request) => {
      if (request.format) return { message: { content: JSON.stringify({ language: 'Swahili' }) } };
      generations++;
      throw new Error('timed out');
    },
  };

  const result = await generateWarningMessage(INPUT, { client });

  assert.equal(result.ok, false);
  assert.equal(generations, 1);
});

test('the prompt states the consequence as repeat offences and never uses the word strike', async () => {
  const { client, generations } = scriptedClient(['Ok.']);

  await generateWarningMessage({ ...INPUT, strikeCount: 1, strikeThreshold: 3 }, { client });

  const [generation] = generations;
  const userPrompt = generation.messages[1].content;
  assert.match(userPrompt, /blocked after 2 more repeat offences/);
  assert.doesNotMatch(userPrompt, /strike/i);
});

test('states a single remaining offence as "the next repeat offence"', async () => {
  const { client, generations } = scriptedClient(['Ok.']);

  await generateWarningMessage({ ...INPUT, strikeCount: 2, strikeThreshold: 3 }, { client });

  assert.match(generations[0].messages[1].content, /next repeat offence will get you blocked/);
});

test('strips emoji from the generated warning', async () => {
  const client = fakeClient('🚓 Message removed by an automated system. ⚠️');

  const result = await generateWarningMessage(INPUT, { client });

  assert.deepEqual(result, { ok: true, text: 'Message removed by an automated system.' });
});

function detectionOnlyClient(language) {
  const requests = [];
  const client = {
    chat: async (request) => {
      requests.push(request);
      if (request.format) return { message: { content: JSON.stringify({ language }) } };
      throw new Error('the warning model must not be called for a templated language');
    },
  };
  return { client, requests };
}

test('a language with a template gets its fixed text without any generation call', async () => {
  const { client, requests } = detectionOnlyClient('French');

  const result = await generateWarningMessage({ ...INPUT, strikeCount: 1, strikeThreshold: 3 }, { client });

  assert.equal(result.ok, true);
  assert.match(result.text, /Après 2 récidives supplémentaires, vous serez bloqué\.$/);
  assert.equal(requests.length, 1);
});

test('a language without a template is written by the warning model', async () => {
  const { client, generations } = scriptedClient(['Ujumbe wako umeondolewa.']);

  const result = await generateWarningMessage(INPUT, { client });

  assert.deepEqual(result, { ok: true, text: 'Ujumbe wako umeondolewa.' });
  assert.equal(generations.length, 1);
});
