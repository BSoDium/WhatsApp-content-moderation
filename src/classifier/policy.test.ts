import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';

process.env.DB_PATH = 'data/test-policy.test.sqlite';
process.env.POLICY_MD_PATH = 'data/test-policy.test.md';

const { loadPolicy, getPolicyText, setPolicyText, importPolicyFromFileIfUnset } = await import('./policy.ts');

after(() => {
  for (const ext of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${ext}`, { force: true });
  rmSync(process.env.POLICY_MD_PATH, { force: true });
});

test('loadPolicy throws and getPolicyText returns "" when no policy has ever been set', () => {
  assert.throws(() => loadPolicy(), /No moderation policy is configured/);
  assert.equal(getPolicyText(), '');
});

test('importPolicyFromFileIfUnset is a no-op when the file does not exist', () => {
  importPolicyFromFileIfUnset();
  assert.equal(getPolicyText(), '');
});

test('importPolicyFromFileIfUnset imports the file once, trimmed, when no policy is set yet', () => {
  writeFileSync(process.env.POLICY_MD_PATH, '  Be kind to everyone.  \n');
  importPolicyFromFileIfUnset();
  assert.equal(getPolicyText(), 'Be kind to everyone.');
  assert.equal(loadPolicy(), 'Be kind to everyone.');
});

test('importPolicyFromFileIfUnset never re-imports once a policy row exists', () => {
  writeFileSync(process.env.POLICY_MD_PATH, 'a completely different policy');
  importPolicyFromFileIfUnset();
  assert.equal(getPolicyText(), 'Be kind to everyone.');
});

test('setPolicyText overrides the imported policy', () => {
  assert.deepEqual(setPolicyText('New policy from the control app.'), { ok: true });
  assert.equal(loadPolicy(), 'New policy from the control app.');
});

test('setPolicyText rejects empty/whitespace-only text, leaving the existing policy intact', () => {
  const result = setPolicyText('   ');
  assert.equal(result.ok, false);
  assert.equal(loadPolicy(), 'New policy from the control app.');
});
