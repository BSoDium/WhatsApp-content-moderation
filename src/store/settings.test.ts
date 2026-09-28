import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = 'data/test-settings.test.sqlite';

const { getRawSetting, getNumberSetting, getBoolSetting, setSetting, listSettings, ensureDefaultsSeeded, getRawValue, setRawValue } =
  await import('./settings.ts');
const { getDb } = await import('./db.ts');

after(() => {
  for (const ext of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${ext}`, { force: true });
});

test('getRawSetting returns the manifest default when no row exists', () => {
  assert.equal(getRawSetting('STRIKE_THRESHOLD'), '3');
});

test('getRawSetting throws for a key not in the manifest', () => {
  assert.throws(() => getRawSetting('NOT_A_REAL_SETTING'));
});

test('setSetting persists a value that getRawSetting then reflects', () => {
  assert.deepEqual(setSetting('STRIKE_THRESHOLD', '5'), { ok: true });
  assert.equal(getRawSetting('STRIKE_THRESHOLD'), '5');
  assert.equal(getNumberSetting('STRIKE_THRESHOLD'), 5);
});

test('setSetting rejects an unknown key', () => {
  const result = setSetting('NOT_A_REAL_SETTING', '1');
  assert.equal(result.ok, false);
});

test('setSetting rejects a non-numeric value for an int setting', () => {
  const result = setSetting('BUFFER_WINDOW_MS', 'soon');
  assert.equal(result.ok, false);
});

test('setSetting rejects a non-integer value for an int setting', () => {
  const result = setSetting('BUFFER_WINDOW_MS', '7.5');
  assert.equal(result.ok, false);
});

test('setSetting accepts a non-integer value for a float setting', () => {
  assert.deepEqual(setSetting('WARNING_TEMPERATURE', '0.7'), { ok: true });
  assert.equal(getNumberSetting('WARNING_TEMPERATURE'), 0.7);
});

test('setSetting accepts an empty string for a blank-default string setting', () => {
  assert.deepEqual(setSetting('WARNING_MODEL', ''), { ok: true });
  assert.equal(getRawSetting('WARNING_MODEL'), '');
});

test('setSetting rejects an empty value for a required string setting', () => {
  const result = setSetting('WARNING_MESSAGE', '');
  assert.equal(result.ok, false);
  assert.equal(getRawSetting('WARNING_MESSAGE'), "That message was removed for violating this chat's policy.");
});

test('setSetting rejects a value below a setting\'s declared minimum', () => {
  const result = setSetting('CLASSIFIER_TIMEOUT_MS', '-1');
  assert.equal(result.ok, false);
});

test('setSetting rejects Infinity for a float setting', () => {
  const result = setSetting('WARNING_TEMPERATURE', 'Infinity');
  assert.equal(result.ok, false);
});

test('setSetting accepts a setting\'s declared minimum value itself', () => {
  assert.deepEqual(setSetting('BUFFER_WINDOW_MS', '0'), { ok: true });
  assert.equal(getNumberSetting('BUFFER_WINDOW_MS'), 0);
});

test('SHADOW_MODE defaults to on', () => {
  assert.equal(getBoolSetting('SHADOW_MODE'), true);
});

test('setSetting accepts "0"/"1" for a bool setting and rejects anything else', () => {
  assert.deepEqual(setSetting('SHADOW_MODE', '0'), { ok: true });
  assert.equal(getBoolSetting('SHADOW_MODE'), false);
  const result = setSetting('SHADOW_MODE', 'false');
  assert.equal(result.ok, false);
  assert.equal(getBoolSetting('SHADOW_MODE'), false); // rejected value never applied
  setSetting('SHADOW_MODE', '1');
});

test('listSettings returns every manifest key with its current value and default', () => {
  const views = listSettings();
  assert.ok(views.length > 0);
  const threshold = views.find((v) => v.key === 'STRIKE_THRESHOLD');
  assert.equal(threshold.default, '3');
  assert.equal(threshold.value, '5'); // set above
});

test('ensureDefaultsSeeded seeds every manifest key without overwriting an existing value', () => {
  ensureDefaultsSeeded();
  assert.equal(getRawSetting('STRIKE_THRESHOLD'), '5'); // untouched, set earlier in this file
  assert.equal(getRawSetting('CLASSIFIER_HISTORY_LIMIT'), '10'); // seeded default, never set
});

test('getRawValue/setRawValue work for a key outside the manifest', () => {
  assert.equal(getRawValue('GLOBAL_POLICY'), undefined);
  setRawValue('GLOBAL_POLICY', 'be nice');
  assert.equal(getRawValue('GLOBAL_POLICY'), 'be nice');
});

// Deliberately the last test in this file: it breaks the shared connection
// on purpose and node:sqlite/db.ts have no clean way to recover it (closeDb()
// itself calls .close() again on an already-closed handle and throws before
// resetting its module state), so every test after this one would fail too.
test('a settings read failure fails open to the manifest default instead of throwing', () => {
  setSetting('STRIKE_THRESHOLD', '5');
  getDb().close(); // simulates a DB failure (e.g. a locked/corrupt file) for the next read
  assert.doesNotThrow(() => getRawSetting('STRIKE_THRESHOLD'));
  assert.equal(getRawSetting('STRIKE_THRESHOLD'), '3'); // falls back to the default, not the '5' just persisted
});
