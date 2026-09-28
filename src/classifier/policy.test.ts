import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = 'data/test-policy.test.sqlite';

const { loadPolicy, getPolicyText, setPolicyText, DEFAULT_POLICY_TEXT } = await import('./policy.ts');

after(() => {
  for (const ext of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${ext}`, { force: true });
});

test('loadPolicy and getPolicyText both fall back to DEFAULT_POLICY_TEXT when no policy has ever been set', () => {
  assert.equal(loadPolicy(), DEFAULT_POLICY_TEXT);
  assert.equal(getPolicyText(), DEFAULT_POLICY_TEXT);
});

test('setPolicyText persists a new policy that both readers then reflect', () => {
  assert.deepEqual(setPolicyText('New policy from the control app.'), { ok: true });
  assert.equal(loadPolicy(), 'New policy from the control app.');
  assert.equal(getPolicyText(), 'New policy from the control app.');
});

test('setPolicyText rejects empty/whitespace-only text, leaving the existing policy intact', () => {
  const result = setPolicyText('   ');
  assert.equal(result.ok, false);
  assert.equal(loadPolicy(), 'New policy from the control app.');
});
