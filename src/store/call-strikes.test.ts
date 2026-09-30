import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = 'data/test-call-strikes.test.sqlite';

const { getCallState, recordUnansweredCall, recordCallStrike, recordAnsweredCall } = await import('./call-strikes.ts');
const { setSetting } = await import('./settings.ts');

after(() => {
  for (const ext of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${ext}`, { force: true });
});

test('getCallState is zeroed for a contact with no rows yet', () => {
  assert.deepEqual(getCallState('nobody@s.whatsapp.net'), { unansweredCount: 0, strikeCount: 0 });
});

test('recordUnansweredCall increments from zero and returns the new count', () => {
  const contact = 'alice@s.whatsapp.net';
  assert.equal(recordUnansweredCall(contact), 1);
  assert.equal(recordUnansweredCall(contact), 2);
  assert.deepEqual(getCallState(contact), { unansweredCount: 2, strikeCount: 0 });
});

test('recordCallStrike increments the strike count without touching the unanswered count', () => {
  const contact = 'bob@s.whatsapp.net';
  recordUnansweredCall(contact);
  recordUnansweredCall(contact);
  assert.equal(recordCallStrike(contact), 1);
  assert.deepEqual(getCallState(contact), { unansweredCount: 2, strikeCount: 1 });
});

test('recordAnsweredCall resets the unanswered count but keeps the strike count', () => {
  const contact = 'carol@s.whatsapp.net';
  recordUnansweredCall(contact);
  recordUnansweredCall(contact);
  recordCallStrike(contact);
  recordCallStrike(contact);
  recordAnsweredCall(contact);
  assert.deepEqual(getCallState(contact), { unansweredCount: 0, strikeCount: 2 });
});

test('call strikes decay after STRIKE_DECAY_MS, unaffected by unanswered calls', (t) => {
  const contact = 'dave@s.whatsapp.net';
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  setSetting('STRIKE_DECAY_MS', '1000');
  recordCallStrike(contact);
  recordCallStrike(contact);

  t.mock.timers.setTime(900);
  recordUnansweredCall(contact);
  t.mock.timers.setTime(1100);
  assert.deepEqual(getCallState(contact), { unansweredCount: 1, strikeCount: 1 });
});
