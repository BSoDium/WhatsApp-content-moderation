import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDnsFailureWatchdog } from './dns-failure-watchdog.ts';

function setup(maxFailingMs = 1000) {
  let clock = 0;
  let tripped = 0;
  const watchdog = createDnsFailureWatchdog({ maxFailingMs, now: () => clock, onTripped: () => tripped++ });
  return {
    watchdog,
    advance: (ms: number) => {
      clock += ms;
    },
    trips: () => tripped,
  };
}

test('trips once DNS has been failing continuously for the whole window', () => {
  const { watchdog, advance, trips } = setup();
  watchdog.recordClose('EAI_AGAIN');
  advance(999);
  watchdog.recordClose('EAI_AGAIN');
  assert.equal(trips(), 0);
  advance(1);
  watchdog.recordClose('ENOTFOUND');
  assert.equal(trips(), 1);
});

test('a successful open resets the window', () => {
  const { watchdog, advance, trips } = setup();
  watchdog.recordClose('EAI_AGAIN');
  advance(900);
  watchdog.recordOpen();
  advance(900);
  watchdog.recordClose('EAI_AGAIN');
  assert.equal(trips(), 0);
});

test('a non-DNS close resets the window', () => {
  const { watchdog, advance, trips } = setup();
  watchdog.recordClose('EAI_AGAIN');
  advance(900);
  watchdog.recordClose('ECONNRESET');
  advance(900);
  watchdog.recordClose('EAI_AGAIN');
  assert.equal(trips(), 0);
});

test('a close with no error code never trips', () => {
  const { watchdog, advance, trips } = setup();
  watchdog.recordClose(undefined);
  advance(10_000);
  watchdog.recordClose(undefined);
  assert.equal(trips(), 0);
});

test('starts a fresh window after tripping instead of firing on every close', () => {
  const { watchdog, advance, trips } = setup();
  watchdog.recordClose('EAI_AGAIN');
  advance(1000);
  watchdog.recordClose('EAI_AGAIN');
  advance(1);
  watchdog.recordClose('EAI_AGAIN');
  assert.equal(trips(), 1);
});
