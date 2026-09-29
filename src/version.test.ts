import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAppVersion } from './version.ts';

test('uses the version the build injected', () => {
  assert.equal(resolveAppVersion('0.4.2'), '0.4.2');
  assert.equal(resolveAppVersion('1.0.0-alpha.1'), '1.0.0-alpha.1');
});

test('trims whitespace around the injected version', () => {
  assert.equal(resolveAppVersion(' 0.4.2\n'), '0.4.2');
});

test('reports dev when nothing was injected', () => {
  assert.equal(resolveAppVersion(undefined), 'dev');
  assert.equal(resolveAppVersion(''), 'dev');
  assert.equal(resolveAppVersion('   '), 'dev');
});
