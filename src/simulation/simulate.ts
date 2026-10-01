// Replays scripted conversations through the real buffer and moderation pipeline with WhatsApp faked out — see README "Simulating conversations" (npm run simulate).

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCENARIO_DIR = fileURLToPath(new URL('./scenarios/', import.meta.url));

const args = process.argv.slice(2);
const stub = args.includes('--stub');
const modelIndex = args.indexOf('--model');
const model = modelIndex === -1 ? undefined : args[modelIndex + 1];
const setPairs = args.flatMap((arg, index) => (arg === '--set' ? [args[index + 1]] : []));
const settingsOverride: Record<string, string> = {
  ...(model ? { OLLAMA_MODEL: model } : {}),
  ...Object.fromEntries(setPairs.map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)])),
};
const flagValueIndexes = new Set(args.flatMap((arg, index) => (arg === '--model' || arg === '--set' ? [index + 1] : [])));
const requested = args.filter((arg, index) => !arg.startsWith('--') && !flagValueIndexes.has(index));

const workDir = mkdtempSync(join(tmpdir(), 'moderation-sim-'));
process.env.DB_PATH = join(workDir, 'sim.sqlite');

const { parseScenario } = await import('./scenario.ts');
const { runScenario, checkExpectations } = await import('./run-scenario.ts');
const { formatOutcome } = await import('./format-outcome.ts');
const { keywordClassifier, stubWarning } = await import('./stubs.ts');

const files = requested.length > 0 ? requested : readdirSync(SCENARIO_DIR).filter((file) => file.endsWith('.json')).map((file) => join(SCENARIO_DIR, file));
let failed = false;

try {
  for (const file of files) {
    const scenario = parseScenario(JSON.parse(readFileSync(file, 'utf8')), file);
    const contactId = `${basename(file, '.json')}@s.whatsapp.net`;
    const dependencies = stub
      ? { classify: keywordClassifier(scenario.flagWords ?? []), generateWarning: stubWarning }
      : { settingsOverride };

    const outcome = await runScenario(scenario, contactId, dependencies);
    console.log(`${formatOutcome(scenario, outcome)}\n`);

    const mismatches = stub ? checkExpectations(outcome, scenario.expect) : [];
    for (const mismatch of mismatches) console.log(`  ✖ ${mismatch}`);
    if (mismatches.length > 0) failed = true;
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
