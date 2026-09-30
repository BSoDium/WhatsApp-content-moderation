import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleStrikes } from './strike-decay.ts';

const DECAY_MS = 1000;

test('nothing decays before a full period has passed', () => {
  assert.deepEqual(settleStrikes({ count: 2, updatedAt: 0 }, 999, DECAY_MS), { count: 2, updatedAt: 0 });
});

test('one strike is forgiven per full period, keeping the partial period', () => {
  assert.deepEqual(settleStrikes({ count: 3, updatedAt: 0 }, 2500, DECAY_MS), { count: 1, updatedAt: 2000 });
});

test('the count floors at zero', () => {
  assert.equal(settleStrikes({ count: 1, updatedAt: 0 }, 10_000, DECAY_MS).count, 0);
});

test('a decay of 0 disables decay', () => {
  assert.deepEqual(settleStrikes({ count: 2, updatedAt: 0 }, 10_000, 0), { count: 2, updatedAt: 0 });
});
