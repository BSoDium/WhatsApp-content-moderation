import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = 'data/test-escalation.test.sqlite';

const { maybeBlockContact } = await import('./escalation.ts');
const { getActiveBlock, markUnblocked } = await import('../store/blocks.ts');
const { addMonitored, setEscalationEnabled } = await import('../store/monitored-contacts.ts');
const { setSetting } = await import('../store/settings.ts');

const HOUR_MS = 60 * 60 * 1000;
const STRIKE_THRESHOLD = 3;
const JITTER_SAMPLES = 40;

after(() => {
  for (const ext of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${ext}`, { force: true });
});

function monitored(contactId: string): string {
  addMonitored(contactId);
  setEscalationEnabled(contactId, true);
  return contactId;
}

async function blockLengthMs(contactId: string): Promise<number> {
  await maybeBlockContact(contactId, STRIKE_THRESHOLD, STRIKE_THRESHOLD, async () => {});
  const block = getActiveBlock(contactId);
  assert.ok(block);
  return block.unblock_at - block.blocked_at;
}

test('with growing blocks on, a repeat block is stored at the next step within the jitter cap', async () => {
  setSetting('BLOCK_BACKOFF', '1');
  const contact = monitored('repeat@s.whatsapp.net');

  const first = await blockLengthMs(contact);
  assert.ok(first >= 3 * HOUR_MS * 0.75 - 1000 && first <= 3 * HOUR_MS * 1.25 + 1000);
  markUnblocked(getActiveBlock(contact)!.id);

  const second = await blockLengthMs(contact);
  assert.ok(second >= 6 * HOUR_MS * 0.75 - 1000 && second <= 6 * HOUR_MS * 1.25 + 1000);
});

test('the 25% jitter cap keeps a short first block well clear of zero', async () => {
  setSetting('BLOCK_BACKOFF', '1');
  for (let i = 0; i < JITTER_SAMPLES; i++) {
    assert.ok((await blockLengthMs(monitored(`cap-${i}@s.whatsapp.net`))) >= 3 * HOUR_MS * 0.75 - 1000);
  }
});

test('with growing blocks off, the full BLOCK_JITTER_MS applies to the fixed duration', async () => {
  setSetting('BLOCK_BACKOFF', '0');
  setSetting('BLOCK_DURATION_MS', String(HOUR_MS));
  setSetting('BLOCK_JITTER_MS', String(HOUR_MS));

  const lengths: number[] = [];
  for (let i = 0; i < JITTER_SAMPLES; i++) lengths.push(await blockLengthMs(monitored(`fixed-${i}@s.whatsapp.net`)));

  assert.ok(lengths.every((ms) => ms <= 2 * HOUR_MS + 1000));
  assert.ok(lengths.some((ms) => Math.abs(ms - HOUR_MS) > HOUR_MS * 0.25));
});
