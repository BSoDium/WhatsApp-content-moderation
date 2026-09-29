import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { rmSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import type { WASocket } from '@whiskeysockets/baileys';

process.env.DB_PATH = 'data/test-blocklist-sync.test.sqlite';

const { attachBlocklistSync } = await import('./blocklist-sync.ts');
const { createBlock, getActiveBlock, getActiveBlocks, markUnblocked } = await import('../store/blocks.ts');
const { getOrm } = await import('../store/db.ts');
const { blocks, contacts } = await import('../store/schema.ts');
const { onControlEvent } = await import('../store/events.ts');

after(() => {
  for (const ext of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${ext}`, { force: true });
});

afterEach(() => {
  for (const block of getActiveBlocks()) markUnblocked(block.id);
});

const MINUTE_MS = 60 * 1000;

interface SocketOptions {
  blocklist?: string[];
  lidToPn?: Record<string, string>;
  pnToLid?: Record<string, string>;
  fetchFails?: boolean;
}

function makeSocket({ blocklist = [], lidToPn = {}, pnToLid = {}, fetchFails = false }: SocketOptions = {}) {
  const ev = new EventEmitter();
  const sock = {
    ev,
    fetchBlocklist: async () => {
      if (fetchFails) throw new Error('offline');
      return blocklist;
    },
    signalRepository: {
      lidMapping: {
        getPNForLID: async (lid: string) => lidToPn[lid] ?? null,
        getLIDForPN: async (pn: string) => pnToLid[pn] ?? null,
      },
    },
  } as unknown as WASocket;
  return { sock, ev };
}

function blockAged(contactId: string, ageMs: number) {
  const id = createBlock(contactId, Date.now() + 60 * MINUTE_MS);
  getOrm().update(blocks).set({ blocked_at: Date.now() - ageMs }).where(eq(blocks.id, id)).run();
}

function learnLid(contactId: string, lid: string) {
  getOrm().insert(contacts).values({ contact_id: contactId, lid, updated_at: Date.now() }).run();
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("a 'remove' notification for a lid closes the block of the phone-number contact it maps to", async () => {
  const contact = '33600000001@s.whatsapp.net';
  createBlock(contact, Date.now() + 60 * MINUTE_MS);
  const { sock, ev } = makeSocket({ lidToPn: { '111@lid': contact } });
  attachBlocklistSync(sock);
  const events: string[] = [];
  const off = onControlEvent((topic) => events.push(topic));

  ev.emit('blocklist.update', { blocklist: ['111@lid'], type: 'remove' });
  await settle();
  off();

  assert.equal(getActiveBlock(contact), undefined);
  assert.deepEqual(events, ['roster']);
});

test("an 'add' notification leaves blocks alone", async () => {
  const contact = '33600000002@s.whatsapp.net';
  createBlock(contact, Date.now() + 60 * MINUTE_MS);
  const { sock, ev } = makeSocket({ lidToPn: { '222@lid': contact } });
  attachBlocklistSync(sock);

  ev.emit('blocklist.update', { blocklist: ['222@lid'], type: 'add' });
  await settle();

  assert.ok(getActiveBlock(contact));
});

test('a removal for someone with no active block does nothing', async () => {
  const { sock, ev } = makeSocket();
  attachBlocklistSync(sock);
  const events: string[] = [];
  const off = onControlEvent((topic) => events.push(topic));

  ev.emit('blocklist.update', { blocklist: ['999@lid'], type: 'remove' });
  await settle();
  off();

  assert.deepEqual(events, []);
});

test('reconcile closes a block whose contact is missing from the WhatsApp blocklist', async () => {
  const contact = '33600000003@s.whatsapp.net';
  learnLid(contact, '333@lid');
  blockAged(contact, 5 * MINUTE_MS);
  const { sock } = makeSocket({ blocklist: ['someone-else@lid'] });

  await attachBlocklistSync(sock).reconcile();

  assert.equal(getActiveBlock(contact), undefined);
});

test('reconcile keeps a block whose contact is still on the blocklist', async () => {
  const contact = '33600000004@s.whatsapp.net';
  learnLid(contact, '444@lid');
  blockAged(contact, 5 * MINUTE_MS);
  const { sock } = makeSocket({ blocklist: ['444@lid'] });

  await attachBlocklistSync(sock).reconcile();

  assert.ok(getActiveBlock(contact));
});

test('reconcile leaves a block alone when no lid is known for the contact', async () => {
  const contact = '33600000005@s.whatsapp.net';
  blockAged(contact, 5 * MINUTE_MS);
  const { sock } = makeSocket({ blocklist: [] });

  await attachBlocklistSync(sock).reconcile();

  assert.ok(getActiveBlock(contact));
});

test('reconcile leaves a block alone when the blocklist cannot be fetched', async () => {
  const contact = '33600000006@s.whatsapp.net';
  learnLid(contact, '666@lid');
  blockAged(contact, 5 * MINUTE_MS);
  const { sock } = makeSocket({ fetchFails: true });

  await attachBlocklistSync(sock).reconcile();

  assert.ok(getActiveBlock(contact));
});

test('reconcile skips a block made moments ago, which WhatsApp may not list yet', async () => {
  const contact = '33600000007@s.whatsapp.net';
  learnLid(contact, '777@lid');
  blockAged(contact, 1000);
  const { sock } = makeSocket({ blocklist: [] });

  await attachBlocklistSync(sock).reconcile();

  assert.ok(getActiveBlock(contact));
});

test('reconcile keeps a block when WhatsApp maps the contact to a lid other than the one the directory recorded', async () => {
  const contact = '33600000008@s.whatsapp.net';
  learnLid(contact, '888-stale@lid');
  blockAged(contact, 5 * MINUTE_MS);
  const { sock } = makeSocket({ blocklist: ['888-current@lid'], pnToLid: { [contact]: '888-current@lid' } });

  await attachBlocklistSync(sock).reconcile();

  assert.ok(getActiveBlock(contact));
});

test('reconcile checks a lid-keyed contact directly against the blocklist', async () => {
  const contact = '999@lid';
  blockAged(contact, 5 * MINUTE_MS);
  const { sock } = makeSocket({ blocklist: [] });

  await attachBlocklistSync(sock).reconcile();

  assert.equal(getActiveBlock(contact), undefined);
});
