// Manual smoke test for the classifier — no WhatsApp connection needed.
// Reads lines from stdin, classifies each as a standalone "newest message"
// (empty conversation history), and prints the verdict.
//
//   npm run classifier:test
//   > hey are you free later
//   { flagged: false, category: 'none', reason: '...' }

import { createInterface } from 'node:readline';
import { classifyMessage } from './classifier.js';

console.log('Type a message and press enter to classify it. Ctrl+C to quit.\n');

const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
rl.prompt();

rl.on('line', async (line) => {
  const message = line.trim();
  if (message) {
    const result = await classifyMessage({ message });
    console.log(result.ok ? result : `[classifier error] ${result.error}`);
  }
  rl.prompt();
});
