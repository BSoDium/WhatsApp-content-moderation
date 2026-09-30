// Runs EVAL_CASES against a real Ollama model — see README "Testing each layer in isolation" (npm run classifier:eval).

import { readFileSync } from 'node:fs';
import { classifyMessage } from './classifier.ts';
import { CONTACT_CONTEXT_EVAL_CASES, EVAL_CASES, HELD_OUT_EVAL_CASES } from './eval-cases.ts';

const MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2:3b';
const POLICY_FILE = process.env.EVAL_POLICY_FILE;
const CONTEXT_FILE = process.env.EVAL_CONTEXT_FILE;

const policy = POLICY_FILE ? readFileSync(POLICY_FILE, 'utf8') : undefined;
const contactContext = CONTEXT_FILE ? readFileSync(CONTEXT_FILE, 'utf8').trim() : undefined;
const RUN_HELD_OUT = process.env.EVAL_HELD_OUT === '1';
const devCases = contactContext ? [...EVAL_CASES, ...CONTACT_CONTEXT_EVAL_CASES] : EVAL_CASES;
const cases = RUN_HELD_OUT ? [...devCases, ...HELD_OUT_EVAL_CASES] : devCases;
let failures = 0;

for (const { name, message, history, expectFlagged, usesContactContext } of cases) {
  const result = await classifyMessage(
    { message, history, model: MODEL, contactContext: usesContactContext ? contactContext : undefined },
    { policy },
  );

  if (!result.ok) {
    failures++;
    console.log(`ERROR  ${name}: ${result.error}`);
    continue;
  }

  const passed = result.flagged === expectFlagged;
  if (!passed) failures++;
  console.log(`${passed ? 'ok   ' : 'WRONG'}  ${name} — flagged=${result.flagged} (${result.category}: ${result.reason})`);
}

console.log(`\n${cases.length - failures}/${cases.length} as expected (${MODEL})`);
process.exit(failures === 0 ? 0 : 1);
