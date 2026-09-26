import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyTailscaleIdentity } from './tailscale-auth.js';

const ALLOWED = 'alice@github';

function reqWithLogin(login) {
  return { headers: login === undefined ? {} : { 'tailscale-user-login': login } };
}

test('accepts a request whose header matches the allowed login', () => {
  assert.equal(verifyTailscaleIdentity(reqWithLogin(ALLOWED), ALLOWED), true);
});

test('rejects a request with no Tailscale-User-Login header', () => {
  assert.equal(verifyTailscaleIdentity(reqWithLogin(undefined), ALLOWED), false);
});

test('rejects a request whose header does not match the allowed login', () => {
  assert.equal(verifyTailscaleIdentity(reqWithLogin('mallory@github'), ALLOWED), false);
});

test('rejects an empty header value', () => {
  assert.equal(verifyTailscaleIdentity(reqWithLogin(''), ALLOWED), false);
});
