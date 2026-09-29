// Runs EVAL_CASES against a real Ollama model — see README "Testing each layer in isolation" (npm run classifier:eval).

import { readFileSync } from 'node:fs';
import { classifyMessage } from './classifier.ts';
import { EVAL_CASES } from './eval-cases.ts';

const MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2:3b';
const POLICY_FILE = process.env.EVAL_POLICY_FILE;

const policy = POLICY_FILE ? readFileSync(POLICY_FILE, 'utf8') : undefined;
let failures = 0;

for (const { name, message, history, expectFlagged } of EVAL_CASES) {
  const result = await classifyMessage({ message, history, model: MODEL }, { policy });

  if (!result.ok) {
    failures++;
    console.log(`ERROR  ${name}: ${result.error}`);
    continue;
  }

  const passed = result.flagged === expectFlagged;
  if (!passed) failures++;
  console.log(`${passed ? 'ok   ' : 'WRONG'}  ${name} — flagged=${result.flagged} (${result.category}: ${result.reason})`);
}

console.log(`\n${EVAL_CASES.length - failures}/${EVAL_CASES.length} as expected (${MODEL})`);
process.exit(failures === 0 ? 0 : 1);
