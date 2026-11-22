import { createLogger } from '../cli/logger.ts';
import { getActiveBlock, getActiveBlocks, markUnblocked } from '../store/blocks.ts';
import { emitControlEvent } from '../store/events.ts';
import { canonicalContactId, lookupLid } from './contact-directory.ts';
import type { WASocket } from '@whiskeysockets/baileys';
import type { BlockRecord } from '../types.ts';

const logger = createLogger('blocklist-sync');

// A block this app just made may not have reached WhatsApp's blocklist yet when a reconcile pass reads it.
const RECONCILE_GRACE_MS = 60 * 1000;

async function contactIdsFor(sock: WASocket, jid: string): Promise<string[]> {
  const ids = new Set([jid, canonicalContactId({ id: jid })]);
  if (jid.endsWith('@lid')) {
    try {
      const pn = await sock.signalRepository.lidMapping.getPNForLID(jid);
      if (pn) ids.add(canonicalContactId({ id: pn }));
    } catch (err) {
      logger.warn({ jid, error: err instanceof Error ? err.message : String(err) }, 'could not resolve a phone number for a lid');
    }
  }
  return [...ids];
}

async function jidsFor(sock: WASocket, contactId: string): Promise<string[]> {
  const jids = new Set([contactId]);
  const directoryLid = lookupLid(contactId);
  if (directoryLid) jids.add(directoryLid);
  if (!contactId.endsWith('@lid')) {
    try {
      const mapped = await sock.signalRepository.lidMapping.getLIDForPN(contactId);
      if (mapped) jids.add(mapped);
    } catch (err) {
      logger.warn({ contactId, error: err instanceof Error ? err.message : String(err) }, 'could not resolve a lid for a phone number');
    }
  }
  return [...jids];
}

function recordUnblocked(contactId: string, blockId: number, source: string): void {
  if (!markUnblocked(blockId)) return;
  emitControlEvent('roster');
  logger.info({ contactId, blockId, source }, 'block closed: contact was unblocked on WhatsApp');
}

async function handleRemoved(sock: WASocket, jids: string[]): Promise<void> {
  const active = new Map(getActiveBlocks().map((block) => [block.contact_id, block]));
  if (active.size === 0) return;

  for (const jid of jids) {
    for (const contactId of await contactIdsFor(sock, jid)) {
      const block = active.get(contactId);
      if (block) recordUnblocked(contactId, block.id, 'blocklist.update');
    }
  }
}

async function fetchBlocklist(sock: WASocket): Promise<Set<string> | null> {
  try {
    return new Set((await sock.fetchBlocklist()).filter((jid): jid is string => typeof jid === 'string'));
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'could not fetch the WhatsApp blocklist; local blocks left as they are');
    return null;
  }
}

async function reconcileBlocks(sock: WASocket, active: BlockRecord[]): Promise<void> {
  const eligible = active.filter((block) => Date.now() - block.blocked_at > RECONCILE_GRACE_MS);
  if (eligible.length === 0) return;

  const blocklist = await fetchBlocklist(sock);
  if (!blocklist) return;

  for (const block of eligible) {
    const jids = await jidsFor(sock, block.contact_id);
    if (!block.contact_id.endsWith('@lid') && jids.length < 2) {
      logger.warn({ contactId: block.contact_id }, 'no @lid known for a blocked contact; cannot check it against the WhatsApp blocklist');
      continue;
    }
    if (!jids.some((jid) => blocklist.has(jid))) recordUnblocked(block.contact_id, block.id, 'reconcile');
  }
}

/**
 * Keeps the local block records in step with contacts unblocked from the
 * phone: `blocklist.update` covers it live, and `reconcile` (run once the
 * connection opens) covers one that happened while the app was offline.
 * Baileys never emits `blocklist.set`, so the full list has to be fetched.
 * `reconcileContact` is the same check for one contact, run right before a
 * strike would escalate to a block: a missed `blocklist.update` otherwise
 * leaves a stale "active" record that silently swallows every later block.
 */
export function attachBlocklistSync(sock: WASocket): { reconcile: () => Promise<void>; reconcileContact: (contactId: string) => Promise<void> } {
  sock.ev.on('blocklist.update', ({ blocklist, type }) => {
    if (type !== 'remove') return;
    handleRemoved(sock, blocklist).catch((err: unknown) =>
      logger.error({ error: err instanceof Error ? err.message : String(err) }, 'handling a blocklist removal failed'),
    );
  });

  return {
    reconcile: () => reconcileBlocks(sock, getActiveBlocks()),
    reconcileContact: async (contactId) => {
      const block = getActiveBlock(contactId);
      if (block) await reconcileBlocks(sock, [block]);
    },
  };
}
