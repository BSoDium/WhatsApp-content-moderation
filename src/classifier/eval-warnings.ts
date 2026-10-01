// Runs WARNING_EVAL_CASES against a real Ollama model through the generated-warning path — see README "Development" (npm run warnings:eval).

import { performance } from 'node:perf_hooks';
import { generateWarningMessage } from './warning-message.ts';
import { setSetting } from '../store/settings.ts';
import { WARNING_EVAL_CASES } from './eval-warning-cases.ts';

const MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2:3b';
const STRIKE_WORD = /strike|frappe/i;
const P95 = 0.95;
const SYSTEM_MARKER = /automat|système|sistema|auto/i;

setSetting('WARNING_GENERATED', '1');
setSetting('OLLAMA_MODEL', MODEL);
if (process.env.OLLAMA_HOST) setSetting('OLLAMA_HOST', process.env.OLLAMA_HOST);
if (process.env.WARNING_MODEL) setSetting('WARNING_MODEL', process.env.WARNING_MODEL);

const latencies: number[] = [];
let failures = 0;

for (const { name, ...input } of WARNING_EVAL_CASES) {
  const startedAt = performance.now();
  const result = await generateWarningMessage(input);
  const elapsedMs = Math.round(performance.now() - startedAt);
  latencies.push(elapsedMs);

  if (!result.ok) {
    failures++;
    console.log(`ERROR  ${name} (${elapsedMs} ms): ${result.error}`);
    continue;
  }

  const problems = [
    STRIKE_WORD.test(result.text) && 'uses the word strike',
    !SYSTEM_MARKER.test(result.text) && 'no automated-message marker (check by eye for other scripts)',
    input.reasons.some(({ reason }) => result.text.toLowerCase().includes(reason.toLowerCase())) && 'echoes a reason',
  ].filter(Boolean);
  if (problems.length > 0) failures++;
  console.log(`${problems.length === 0 ? 'ok   ' : 'CHECK'}  ${name} (${elapsedMs} ms)\n        ${result.text}${problems.length ? `\n        -> ${problems.join('; ')}` : ''}`);
}

latencies.sort((a, b) => a - b);
const p95 = latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * P95) - 1)];
console.log(`\n${WARNING_EVAL_CASES.length - failures}/${WARNING_EVAL_CASES.length} clean (${MODEL}); median ${latencies[Math.floor(latencies.length / 2)]} ms, p95 ${p95} ms`);
process.exit(failures === 0 ? 0 : 1);
