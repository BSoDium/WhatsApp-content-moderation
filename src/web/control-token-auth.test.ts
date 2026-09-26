import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyControlToken, verifyControlCookie } from './control-token-auth.ts';

const EXPECTED = 'a-very-secret-token';

function reqWithHeader(token) {
  return { headers: token === undefined ? {} : { 'x-control-token': token } };
}

function paramsWithToken(token) {
  return new URLSearchParams(token === undefined ? '' : { token });
}

test('accepts the token via the X-Control-Token header', () => {
  assert.equal(verifyControlToken(reqWithHeader(EXPECTED), paramsWithToken(undefined), EXPECTED), true);
});

test('accepts the token via the query string, when no header is present', () => {
  assert.equal(verifyControlToken(reqWithHeader(undefined), paramsWithToken(EXPECTED), EXPECTED), true);
});

test('uses the header rather than the query string when both are present', () => {
  assert.equal(verifyControlToken(reqWithHeader(EXPECTED), paramsWithToken('wrong'), EXPECTED), true);
  assert.equal(verifyControlToken(reqWithHeader('wrong'), paramsWithToken(EXPECTED), EXPECTED), false);
});

test('rejects a request with neither a header nor a query token', () => {
  assert.equal(verifyControlToken(reqWithHeader(undefined), paramsWithToken(undefined), EXPECTED), false);
});

test('rejects a mismatched token', () => {
  assert.equal(verifyControlToken(reqWithHeader('wrong-token'), paramsWithToken(undefined), EXPECTED), false);
});

test('rejects a token of different length without throwing', () => {
  assert.equal(verifyControlToken(reqWithHeader('short'), paramsWithToken(undefined), EXPECTED), false);
});

function reqWithCookie(cookieHeader) {
  return { headers: cookieHeader === undefined ? {} : { cookie: cookieHeader } };
}

test('verifyControlCookie accepts a matching controlToken cookie', () => {
  assert.equal(verifyControlCookie(reqWithCookie(`controlToken=${EXPECTED}`), EXPECTED), true);
});

test('verifyControlCookie finds the cookie among several others', () => {
  assert.equal(verifyControlCookie(reqWithCookie(`foo=bar; controlToken=${EXPECTED}; baz=qux`), EXPECTED), true);
});

test('verifyControlCookie decodes a percent-encoded cookie value', () => {
  assert.equal(verifyControlCookie(reqWithCookie(`controlToken=${encodeURIComponent(EXPECTED)}`), EXPECTED), true);
});

test('verifyControlCookie rejects a mismatched cookie', () => {
  assert.equal(verifyControlCookie(reqWithCookie('controlToken=wrong'), EXPECTED), false);
});

test('verifyControlCookie rejects a missing Cookie header entirely', () => {
  assert.equal(verifyControlCookie(reqWithCookie(undefined), EXPECTED), false);
});

test('verifyControlCookie rejects a Cookie header with no controlToken entry', () => {
  assert.equal(verifyControlCookie(reqWithCookie('foo=bar'), EXPECTED), false);
});
