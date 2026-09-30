import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = 'data/test-strikes.test.sqlite';

const { getStrikeCount, recordStrike } = await import('./strikes.ts');
const { setSetting } = await import('./settings.ts');

after(() => {
  for (const ext of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${ext}`, { force: true });
});

test('getStrikeCount is 0 for a contact with no rows yet', () => {
  assert.equal(getStrikeCount('nobody@s.whatsapp.net'), 0);
});

test('recordStrike increments from zero and returns the new count', () => {
  const contact = 'alice@s.whatsapp.net';
  assert.equal(recordStrike(contact), 1);
  assert.equal(recordStrike(contact), 2);
  assert.equal(getStrikeCount(contact), 2);
});

test('a strike decays after STRIKE_DECAY_MS and the partial window is kept', (t) => {
  const contact = 'bob@s.whatsapp.net';
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  setSetting('STRIKE_DECAY_MS', '1000');
  recordStrike(contact);
  recordStrike(contact);

  t.mock.timers.setTime(999);
  assert.equal(getStrikeCount(contact), 2);
  t.mock.timers.setTime(1500);
  assert.equal(getStrikeCount(contact), 1);
  t.mock.timers.setTime(2000);
  assert.equal(getStrikeCount(contact), 0);
  t.mock.timers.setTime(9000);
  assert.equal(getStrikeCount(contact), 0);
});

test('a new strike restarts the decay timer', (t) => {
  const contact = 'carol@s.whatsapp.net';
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  setSetting('STRIKE_DECAY_MS', '1000');
  recordStrike(contact);

  t.mock.timers.setTime(900);
  assert.equal(recordStrike(contact), 2);
  t.mock.timers.setTime(1800);
  assert.equal(getStrikeCount(contact), 2);
  t.mock.timers.setTime(1900);
  assert.equal(getStrikeCount(contact), 1);
});

test('STRIKE_DECAY_MS of 0 keeps strikes forever', (t) => {
  const contact = 'dave@s.whatsapp.net';
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  setSetting('STRIKE_DECAY_MS', '0');
  recordStrike(contact);

  t.mock.timers.setTime(365 * 24 * 60 * 60 * 1000);
  assert.equal(getStrikeCount(contact), 1);
});
