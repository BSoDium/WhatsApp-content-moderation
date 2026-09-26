import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = 'data/test-blocks.test.sqlite';

const { createBlock, getActiveBlock, getExpiredBlocks, markUnblocked } = await import('./blocks.js');

after(() => {
  for (const ext of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${ext}`, { force: true });
});

test('a contact with no block record has no active block', () => {
  assert.equal(getActiveBlock('nobody@s.whatsapp.net'), undefined);
});

test('createBlock opens an active block that getActiveBlock finds', () => {
  const contact = 'alice@s.whatsapp.net';
  createBlock(contact, Date.now() + 60_000);

  const active = getActiveBlock(contact);
  assert.equal(active.contact_id, contact);
  assert.equal(active.unblocked_at, null);
});

test('getExpiredBlocks only returns blocks whose unblock_at has passed', () => {
  const stillBlocked = 'bob@s.whatsapp.net';
  const expired = 'carol@s.whatsapp.net';
  createBlock(stillBlocked, Date.now() + 60_000);
  createBlock(expired, Date.now() - 1000);

  const expiredIds = getExpiredBlocks().map((b) => b.contact_id);
  assert.ok(expiredIds.includes(expired));
  assert.ok(!expiredIds.includes(stillBlocked));
});

test('markUnblocked resolves the block and getActiveBlock stops finding it', () => {
  const contact = 'dave@s.whatsapp.net';
  const blockId = createBlock(contact, Date.now() - 1000);

  assert.equal(markUnblocked(blockId), true);
  assert.equal(getActiveBlock(contact), undefined);
});

test('markUnblocked on an already-resolved block is a safe no-op (returns false)', () => {
  const contact = 'erin@s.whatsapp.net';
  const blockId = createBlock(contact, Date.now() - 1000);

  assert.equal(markUnblocked(blockId), true);
  assert.equal(markUnblocked(blockId), false);
});
