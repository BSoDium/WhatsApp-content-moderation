// Manual smoke test for the message buffer — see README "Testing each layer in isolation" (npm run buffer:test).

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
