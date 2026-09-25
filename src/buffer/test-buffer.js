// Manual smoke test for the message buffer — no WhatsApp connection needed.
// Type lines quickly to see them grouped into one flush; pause past
// BUFFER_WINDOW_MS to see a new burst start.
//
//   BUFFER_WINDOW_MS=2000 npm run buffer:test
//   > hey
//   > you there
//   (2s of silence)
//   [flush] test-contact: [ 'hey', 'you there' ]

import { createInterface } from 'node:readline';
import { createMessageBuffer } from './message-buffer.js';

const CONTACT = 'test-contact';

const buffer = createMessageBuffer((contactId, messages) => {
  console.log(`[flush] ${contactId}:`, messages);
});

console.log('Type messages and press enter to buffer them. Ctrl+C to quit.\n');

const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
rl.prompt();

rl.on('line', (line) => {
  const message = line.trim();
  if (message) buffer.push(CONTACT, message);
  rl.prompt();
});
