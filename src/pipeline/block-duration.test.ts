import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import type { BlockRecord } from '../types.ts';

process.env.DB_PATH = 'data/test-block-duration.test.sqlite';

const { countRecentBlocks, baseBlockDurationMs } = await import('./block-duration.ts');
const { createBlock, markUnblocked } = await import('../store/blocks.ts');
const { setSetting } = await import('../store/settings.ts');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

after(() => {
  for (const ext of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${ext}`, { force: true });
});

function record(blockedAt: number, unblockAt: number): BlockRecord {
  return { id: 1, contact_id: 'x', blocked_at: blockedAt, unblock_at: unblockAt, unblocked_at: unblockAt };
}

test('countRecentBlocks counts a chain of blocks separated by less than the reset window', () => {
  const now = 100 * DAY_MS;
  const history = [record(now - 2 * DAY_MS, now - DAY_MS), record(now - 4 * DAY_MS, now - 3 * DAY_MS)];
  assert.equal(countRecentBlocks(history, now, 7 * DAY_MS), 2);
});

test('countRecentBlocks stops at the first gap longer than the reset window', () => {
  const now = 100 * DAY_MS;
  const history = [record(now - 2 * DAY_MS, now - DAY_MS), record(now - 40 * DAY_MS, now - 39 * DAY_MS)];
  assert.equal(countRecentBlocks(history, now, 7 * DAY_MS), 1);
});

test('countRecentBlocks is zero when the last block ended longer ago than the reset window', () => {
  const now = 100 * DAY_MS;
  assert.equal(countRecentBlocks([record(now - 20 * DAY_MS, now - 19 * DAY_MS)], now, 7 * DAY_MS), 0);
  assert.equal(countRecentBlocks([], now, 7 * DAY_MS), 0);
});

test('static mode always uses BLOCK_DURATION_MS', () => {
  const contact = 'static@s.whatsapp.net';
  createBlock(contact, Date.now() + HOUR_MS);
  assert.equal(baseBlockDurationMs(contact), DAY_MS);
});

test('escalating mode doubles per repeat block up to the cap, then resets', () => {
  setSetting('BLOCK_ESCALATING', '1');
  const contact = 'repeat@s.whatsapp.net';
  const expected = [3, 6, 12, 24];

  for (const hours of expected) {
    assert.equal(baseBlockDurationMs(contact), hours * HOUR_MS);
    markUnblocked(createBlock(contact, Date.now() + hours * HOUR_MS));
  }

  setSetting('BLOCK_ESCALATION_MAX_MS', String(30 * HOUR_MS));
  assert.equal(baseBlockDurationMs(contact), 30 * HOUR_MS);

  const later = Date.now() + 8 * DAY_MS;
  assert.equal(baseBlockDurationMs(contact, later), 3 * HOUR_MS);
});
