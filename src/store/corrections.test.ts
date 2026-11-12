import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = 'data/test-corrections.test.sqlite';

const { markCorrection, getCorrectionsByAuditLogId } = await import('./corrections.ts');
const { logMessage } = await import('./audit-log.ts');
const { getStrikeCount, recordStrike } = await import('./strikes.ts');

after(() => {
  for (const ext of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${ext}`, { force: true });
});

const FLAGGED = { ok: true, flagged: true, category: 'insult', reason: 'rude' } as const;
const PASSED = { ok: true, flagged: false, category: 'none', reason: '' } as const;

function log(contactId: string, classification: Parameters<typeof logMessage>[0]['classification'], action: string, direction: 'me' | 'them' = 'them') {
  return logMessage({ contactId, direction, message: 'text', classification, action });
}

test('a false positive on the strike-opening message gives the strike back', () => {
  const contact = 'fp-strike@s.whatsapp.net';
  recordStrike(contact);
  recordStrike(contact);
  const id = log(contact, FLAGGED, 'delete+warn');

  const result = markCorrection(id, 'false_positive', 'was banter');

  assert.ok(result.ok);
  assert.equal(result.correction.strike_reverted, 1);
  assert.equal(result.correction.note, 'was banter');
  assert.equal(getStrikeCount(contact), 1);
});

test('a false positive on a follow-up deletion leaves the strike count alone', () => {
  const contact = 'fp-follow-up@s.whatsapp.net';
  recordStrike(contact);
  const id = log(contact, FLAGGED, 'delete');

  const result = markCorrection(id, 'false_positive');

  assert.ok(result.ok);
  assert.equal(result.correction.strike_reverted, 0);
  assert.equal(getStrikeCount(contact), 1);
});

test('a shadow-mode false positive is recorded with no strike to give back', () => {
  const id = log('fp-shadow@s.whatsapp.net', FLAGGED, 'shadow');

  const result = markCorrection(id, 'false_positive');

  assert.ok(result.ok);
  assert.equal(result.correction.strike_reverted, 0);
});

test('a message can only be marked once, so a strike is never returned twice', () => {
  const contact = 'twice@s.whatsapp.net';
  recordStrike(contact);
  recordStrike(contact);
  const id = log(contact, FLAGGED, 'delete+warn');

  assert.ok(markCorrection(id, 'false_positive').ok);
  const second = markCorrection(id, 'false_positive');

  assert.deepEqual(second.ok === false && second.reason, 'already-marked');
  assert.equal(getStrikeCount(contact), 1);
});

test('a false negative is recorded without touching strikes', () => {
  const contact = 'fn@s.whatsapp.net';
  recordStrike(contact);
  const id = log(contact, PASSED, 'none');

  const result = markCorrection(id, 'false_negative');

  assert.ok(result.ok);
  assert.equal(result.correction.kind, 'false_negative');
  assert.equal(getStrikeCount(contact), 1);
});

test('the kind must match what the classifier decided', () => {
  const flagged = log('mismatch@s.whatsapp.net', FLAGGED, 'delete+warn');
  const passed = log('mismatch@s.whatsapp.net', PASSED, 'none');

  assert.equal(markCorrection(flagged, 'false_negative').ok, false);
  assert.equal(markCorrection(passed, 'false_positive').ok, false);
});

test('outgoing rows and classifier errors cannot be marked', () => {
  const outgoing = log('ineligible@s.whatsapp.net', PASSED, 'outgoing', 'me');
  const errored = log('ineligible@s.whatsapp.net', { ok: false, error: 'timeout' }, 'classifier_error');

  assert.equal(markCorrection(outgoing, 'false_negative').ok, false);
  assert.equal(markCorrection(errored, 'false_negative').ok, false);
});

test('an unknown audit log id is not found', () => {
  const result = markCorrection(999_999, 'false_positive');

  assert.equal(result.ok === false && result.reason, 'not-found');
});

test('getCorrectionsByAuditLogId returns only the requested rows, keyed by id', () => {
  const marked = log('lookup@s.whatsapp.net', PASSED, 'none');
  const unmarked = log('lookup@s.whatsapp.net', PASSED, 'none');
  markCorrection(marked, 'false_negative');

  const found = getCorrectionsByAuditLogId([marked, unmarked]);

  assert.deepEqual([...found.keys()], [marked]);
  assert.equal(getCorrectionsByAuditLogId([]).size, 0);
});
