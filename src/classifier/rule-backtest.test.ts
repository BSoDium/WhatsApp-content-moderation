import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = 'data/test-rule-backtest.test.sqlite';

const { backtestRule } = await import('./rule-backtest.ts');
const { logMessage } = await import('../store/audit-log.ts');

after(() => {
  for (const ext of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${ext}`, { force: true });
});

const FLAGGED = { ok: true, flagged: true, category: 'insult', reason: 'rude' } as const;
const PASSED = { ok: true, flagged: false, category: 'none', reason: '' } as const;

function log(contactId: string, message: string, flagged: boolean, createdAt: number) {
  return logMessage({ contactId, direction: 'them', message, classification: flagged ? FLAGGED : PASSED, action: flagged ? 'delete' : 'none', createdAt });
}

// A classifier that flags exactly the messages containing the word "call".
const classify = (async ({ message }: { message: string }) => ({ ok: true, flagged: message.includes('call'), category: 'x', reason: '' })) as never;

test('scores labelled messages before and after, and reports unlabelled verdicts that flip', async () => {
  const contact = 'bt@s.whatsapp.net';
  const missed = log(contact, 'call me back', false, 1000);
  const wrongFlag = log(contact, 'see you', true, 2000);
  log(contact, 'call me later', false, 3000);
  log(contact, 'thanks', false, 4000);

  const result = await backtestRule({
    scope: 'contact',
    candidate: 'flag call demands',
    classify,
    examples: [
      { auditLogId: missed, contactId: contact, message: 'call me back', createdAt: 1000, verdict: 'unacceptable', note: null, flagged: false },
      { auditLogId: wrongFlag, contactId: contact, message: 'see you', createdAt: 2000, verdict: 'acceptable', note: null, flagged: true },
    ],
  });

  assert.deepEqual(result.summary, { labelled: 2, correctBefore: 0, correctNow: 2, failed: 0, checkedUnlabelled: 2 });
  assert.deepEqual(result.flips.map((flip) => ({ message: flip.message, wasFlagged: flip.wasFlagged, nowFlagged: flip.nowFlagged })), [
    { message: 'call me later', wasFlagged: false, nowFlagged: true },
  ]);
});

test('a classifier failure is counted as failed, never as a verdict or a flip', async () => {
  const contact = 'bt-fail@s.whatsapp.net';
  const id = log(contact, 'hello', false, 1000);
  log(contact, 'other', false, 2000);
  const failing = (async () => ({ ok: false, error: 'timeout' })) as never;

  const result = await backtestRule({
    scope: 'global',
    candidate: 'policy',
    classify: failing,
    examples: [{ auditLogId: id, contactId: contact, message: 'hello', createdAt: 1000, verdict: 'acceptable', note: null, flagged: false }],
  });

  assert.equal(result.summary.failed, 1);
  assert.equal(result.summary.correctNow, 0);
  assert.equal(result.labelled[0].nowCorrect, null);
  assert.deepEqual(result.flips, []);
});

test('the candidate is passed as the policy for global scope and as contact context for contact scope', async () => {
  const contact = 'bt-scope@s.whatsapp.net';
  const id = log(contact, 'hi', false, 1000);
  const example = { auditLogId: id, contactId: contact, message: 'hi', createdAt: 1000, verdict: 'acceptable' as const, note: null, flagged: false };
  const calls: { contactContext?: string; policy?: string }[] = [];
  const spy = (async (input: { contactContext?: string }, deps: { policy?: string }) => {
    calls.push({ contactContext: input.contactContext, policy: deps.policy });
    return PASSED;
  }) as never;

  await backtestRule({ scope: 'global', candidate: 'GLOBAL RULE', classify: spy, examples: [example] });
  await backtestRule({ scope: 'contact', candidate: 'CONTACT RULE', classify: spy, examples: [example] });

  assert.deepEqual(calls[0], { contactContext: undefined, policy: 'GLOBAL RULE' });
  assert.deepEqual(calls[1], { contactContext: 'CONTACT RULE', policy: undefined });
});
