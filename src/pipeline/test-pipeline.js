// Manual smoke test for the moderation pipeline — buffers stdin lines like
// test-buffer.js, then runs each flush through handleBurst with
// deleteForMe/sendWarning stubbed as console logs. Needs Ollama running and
// config/policy.md filled in, same as classifier:test.
//
//   npm run pipeline:test

import { createInterface } from 'node:readline';
import { rmSync } from 'node:fs';
import { createMessageBuffer } from '../buffer/message-buffer.js';
import { handleBurst } from './moderation-pipeline.js';

process.env.DB_PATH = 'data/test-pipeline.sqlite';
const CONTACT = 'test-contact@s.whatsapp.net';

const actions = {
  deleteForMe: async (contactId, key) => console.log(`[deleteForMe] ${contactId} key=${JSON.stringify(key)}`),
  sendWarning: async (contactId, text) => console.log(`[sendWarning] ${contactId}: ${text}`),
  block: async (contactId) => console.log(`[block] ${contactId}`),
};

const buffer = createMessageBuffer(async (contactId, messages) => {
  const { strikeCount } = await handleBurst({ contactId, messages }, actions);
  console.log(`[flush] ${contactId} strikeCount=${strikeCount}`);
});

console.log('Type messages and press enter to buffer + classify them. Ctrl+C to quit.\n');

const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
rl.prompt();

rl.on('line', (line) => {
  const text = line.trim();
  if (text) buffer.push(CONTACT, { text, key: { id: `test-${Date.now()}` }, timestamp: Date.now() });
  rl.prompt();
});

rl.on('close', () => {
  for (const ext of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${ext}`, { force: true });
  process.exit(0);
});
