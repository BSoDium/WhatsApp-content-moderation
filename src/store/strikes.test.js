import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = 'data/test-strikes.test.sqlite';

const { getStrikeCount, recordStrike, decayStrike } = await import('./strikes.js');

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

test('decayStrike decrements by one', () => {
  const contact = 'bob@s.whatsapp.net';
  recordStrike(contact);
  recordStrike(contact);
  assert.equal(decayStrike(contact), 1);
});

test('decayStrike floors at zero instead of going negative', () => {
  const contact = 'carol@s.whatsapp.net';
  assert.equal(getStrikeCount(contact), 0);
  assert.equal(decayStrike(contact), 0);
  assert.equal(decayStrike(contact), 0);
});
