import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = 'data/test-settings.test.sqlite';

const { getRawSetting, getNumberSetting, setSetting, listSettings, ensureDefaultsSeeded, getRawValue, setRawValue } =
  await import('./settings.ts');

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
