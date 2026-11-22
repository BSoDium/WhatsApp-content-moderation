import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = 'data/test-rule-suggestion.test.sqlite';

const { suggestRule } = await import('./rule-suggestion.ts');
const { logMessage } = await import('../store/audit-log.ts');
const { markCorrection } = await import('../store/corrections.ts');
const { addMonitored, setContext } = await import('../store/monitored-contacts.ts');

after(() => {
  for (const ext of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${ext}`, { force: true });
});

const PASSED = { ok: true, flagged: false, category: 'none', reason: '' } as const;
const EMPTY_BACKTEST = { labelled: [], flips: [], summary: { labelled: 0, correctBefore: 0, correctNow: 0, failed: 0, checkedUnlabelled: 0 } };

function labelled(contactId: string, message: string) {
  const id = logMessage({ contactId, direction: 'them', message, classification: PASSED, action: 'none' });
  markCorrection(id, 'false_negative', 'should be flagged');
}

test('refuses with no-labels when nothing has been labelled, without calling the model', async () => {
  const contact = 'sg-none@s.whatsapp.net';
  addMonitored(contact);
  let called = false;

  const result = await suggestRule({ contactId: contact }, { propose: async () => ((called = true), { ok: false, error: 'x' }) });

  assert.deepEqual(result.ok === false && result.reason, 'no-labels');
  assert.equal(called, false);
});

test('refuses a contact that is not monitored', async () => {
  const result = await suggestRule({ contactId: 'sg-unknown@s.whatsapp.net' });

  assert.deepEqual(result.ok === false && result.reason, 'not-monitored');
});

test('proposes from that contact\'s labels with their current context, then backtests the candidate as contact scope', async () => {
  const contact = 'sg-contact@s.whatsapp.net';
  addMonitored(contact);
  setContext(contact, 'Flag demands.');
  labelled(contact, 'answer me right now');
  labelled('sg-other@s.whatsapp.net', 'unrelated');
  const proposals: { scope: string; currentRule: string; examples: { message: string; verdict: string; note: string | null }[] }[] = [];
  const backtests: { scope: string; candidate: string }[] = [];

  const result = await suggestRule(
    { contactId: contact },
    {
      propose: async (input) => (proposals.push(input), { ok: true, rule: 'Flag demands to answer.', rationale: 'covers it' }),
      backtest: async (input) => (backtests.push(input), EMPTY_BACKTEST),
    },
  );

  assert.deepEqual(result, { ok: true, currentRule: 'Flag demands.', candidate: 'Flag demands to answer.', rationale: 'covers it', backtest: EMPTY_BACKTEST });
  assert.equal(proposals[0].scope, 'contact');
  assert.deepEqual(proposals[0].examples.map(({ message, verdict, note }) => ({ message, verdict, note })), [
    { message: 'answer me right now', verdict: 'unacceptable', note: 'should be flagged' },
  ]);
  assert.deepEqual(backtests, [{ scope: 'contact', candidate: 'Flag demands to answer.', examples: backtests[0].examples }]);
});

test('global scope draws on every contact\'s labels', async () => {
  const seen: string[] = [];

  const result = await suggestRule('global', {
    propose: async (input) => (seen.push(...input.examples.map((example) => example.message)), { ok: true, rule: 'r', rationale: '' }),
    backtest: async () => EMPTY_BACKTEST,
  });

  assert.equal(result.ok, true);
  assert.ok(seen.includes('answer me right now') && seen.includes('unrelated'));
});

test('a failed proposal is returned as proposal-failed and nothing is backtested', async () => {
  let backtested = false;

  const result = await suggestRule('global', {
    propose: async () => ({ ok: false, error: 'model unreachable' }),
    backtest: async () => ((backtested = true), EMPTY_BACKTEST),
  });

  assert.deepEqual(result.ok === false && [result.reason, result.error], ['proposal-failed', 'model unreachable']);
  assert.equal(backtested, false);
});
