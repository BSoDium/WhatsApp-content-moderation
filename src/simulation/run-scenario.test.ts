import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DB_PATH = 'data/test-simulation.test.sqlite';

const { parseScenario } = await import('./scenario.ts');
const { runScenario, checkExpectations } = await import('./run-scenario.ts');
const { keywordClassifier, stubWarning } = await import('./stubs.ts');

const SCENARIO_DIR = fileURLToPath(new URL('./scenarios/', import.meta.url));

after(() => {
  for (const ext of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${ext}`, { force: true });
});

const files = readdirSync(SCENARIO_DIR).filter((file) => file.endsWith('.json') && !file.endsWith('.local.json'));

for (const file of files) {
  test(`scenario ${file} meets its expectations`, async () => {
    const scenario = parseScenario(JSON.parse(readFileSync(`${SCENARIO_DIR}${file}`, 'utf8')), file);
    const dependencies = { classify: keywordClassifier(scenario.flagWords ?? []), generateWarning: stubWarning };

    const outcome = await runScenario(scenario, `${basename(file, '.json')}@s.whatsapp.net`, dependencies);

    assert.deepEqual(checkExpectations(outcome, scenario.expect), []);
  });
}

test('parseScenario rejects a scenario without messages', () => {
  assert.throws(() => parseScenario({ name: 'empty', messages: [] }, 'empty.json'), /non-empty "messages"/);
});
