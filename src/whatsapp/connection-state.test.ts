import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getConnectionState, setConnectionState } from './connection-state.ts';

test('starts as connecting with no status code', () => {
  assert.equal(getConnectionState().status, 'connecting');
  assert.equal(getConnectionState().statusCode, null);
});

test('records the new status, the close code, and a fresh since', () => {
  const before = Date.now();
  setConnectionState('logged-out', 401);
  const state = getConnectionState();
  assert.deepEqual({ status: state.status, statusCode: state.statusCode }, { status: 'logged-out', statusCode: 401 });
  assert.ok(state.since >= before);
});

test('clears the status code when moving to a state without one', () => {
  setConnectionState('reconnecting', 428);
  setConnectionState('open');
  assert.equal(getConnectionState().statusCode, null);
});

test('reports a failed reconnect as offline', () => {
  setConnectionState('offline');
  assert.equal(getConnectionState().status, 'offline');
});
