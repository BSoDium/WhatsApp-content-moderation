import { getDb } from '../store/db.ts';
import type { Chat, Contact, WAMessage, WASocket } from '@whiskeysockets/baileys';
import type { ContactRecord } from '../types.ts';

interface ContactEntry extends Partial<Contact> {
  id: string;
  lastMessageAt?: number | null;
}

export const NON_INDIVIDUAL_JID_SUFFIXES = ['@g.us', '@broadcast'];

function formatJid(jid: string): string {
  const [user] = jid.split('@');
  return user.startsWith('+') ? user : `+${user}`;
}

// COALESCE against the existing name/notify/verifiedName columns, not a full
// overwrite, so a later partial (e.g. {id, notify} on every incoming
// message) never erases a fuller name an earlier event already found.
// last_message_at instead takes the MAX of old vs incoming, since two real
// timestamps should keep the more recent one regardless of event order,
// and a touch that doesn't know a timestamp (a pure name-sync event) must
// leave it untouched rather than clearing it.
function upsert(entry: ContactEntry): void {
  getDb()
    .prepare(
      `INSERT INTO contacts (contact_id, name, notify, verified_name, last_message_at, updated_at)
       VALUES (@contactId, @name, @notify, @verifiedName, @lastMessageAt, @updatedAt)
       ON CONFLICT (contact_id) DO UPDATE SET
         name = COALESCE(excluded.name, name),
         notify = COALESCE(excluded.notify, notify),
         verified_name = COALESCE(excluded.verified_name, verified_name),
         last_message_at = CASE
           WHEN excluded.last_message_at IS NULL THEN last_message_at
           WHEN last_message_at IS NULL THEN excluded.last_message_at
           ELSE MAX(last_message_at, excluded.last_message_at)
         END,
         updated_at = excluded.updated_at`,
    )
    .run({
      contactId: entry.id,
      // `|| null`, not `?? null`: an empty string must COALESCE the same as
      // a missing field (SQLite's COALESCE treats '' as non-null and would
      // otherwise let it erase a previously-found name).
      name: entry.name || null,
      notify: entry.notify || null,
      verifiedName: entry.verifiedName || null,
      lastMessageAt: entry.lastMessageAt ?? null,
      updatedAt: Date.now(),
    });
}

function ingest(entries: Array<Partial<Contact> & { id?: string; lastMessageAt?: number | null }> = []): void {
  for (const entry of entries) {
    const id = entry.id;
    if (typeof id !== 'string' || NON_INDIVIDUAL_JID_SUFFIXES.some((suffix) => id.endsWith(suffix))) continue;
    upsert({ ...entry, id });
  }
}

// chats[].conversationTimestamp is the only source of "last contacted" for a contact synced before this feature existed, i.e. everyone right after a fresh QR relink.
function ingestChats(chats: Chat[] = []): void {
  ingest(
    chats.flatMap((chat) => chat.id ? [{
      id: chat.id,
      lastMessageAt: chat.conversationTimestamp != null ? Number(chat.conversationTimestamp) * 1000 : null,
    }] : []),
  );
}

// Tracks activity for every contact, monitored or not (unlike the
// moderation pipeline's own messages.upsert handling in index.ts, which
// only processes monitored contacts) — this is a directory of everyone,
// and either direction (sent or received) counts as "contacted".
function ingestMessages(messages: WAMessage[] = []): void {
  ingest(
    messages
      .filter((msg) => msg.key?.remoteJid)
      .flatMap((msg) => msg.key.remoteJid ? [{ id: msg.key.remoteJid, lastMessageAt: msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : null }] : []),
  );
}

function toContact(contactId: string, row: ContactRecord | undefined) {
  const name = row?.name || row?.notify || row?.verified_name;
  return { id: contactId, name: name ?? formatJid(contactId), lastMessageAt: row?.last_message_at ?? null };
}

/**
 * Creates a SQLite-backed directory of every contact this account has ever
 * heard of, since @whiskeysockets/baileys 7.0.0-rc14 ships no built-in store
 * and only emits its one-time bulk sync ('messaging-history.set') on a
 * contact's very first login, never on a reconnect that reuses an existing
 * auth_info/ session. Persisting means a contact learned once (however that
 * happened) stays in the directory across restarts.
 *
 * Name metadata fills in cumulatively from three events, fullest-but-rare
 * to partial-but-frequent: 'messaging-history.set' (the phone's synced
 * address book), 'contacts.upsert' (bulk app-state sync), and
 * 'contacts.update' (incremental partials, notably {id, notify} on every
 * incoming message that carries a pushName). Activity (lastMessageAt) fills
 * in from 'messaging-history.set's `chats` array (backfill at link time)
 * and every live 'messages.upsert' event (both directions) from then on.
 *
 * A contact who's never messaged and isn't in the phone's address book will
 * only ever have a bare JID and a null lastMessageAt — list()/get() fall
 * back to a formatted JID so callers never have to special-case a missing
 * name.
 *
 * @returns {{
 *   attach: (sock: WASocket) => void,
 *   list: () => { id: string, name: string, lastMessageAt: number | null }[],
 *   get: (contactId: string) => { id: string, name: string, lastMessageAt: number | null },
 * }}
 */
export function createContactDirectory() {
  function attach(sock: WASocket): void {
    sock.ev.on('messaging-history.set', ({ contacts: initial, chats }) => {
      ingest(initial);
      ingestChats(chats);
    });
    sock.ev.on('contacts.upsert', (entries) => ingest(entries));
    sock.ev.on('contacts.update', (entries) => ingest(entries));
    sock.ev.on('messages.upsert', ({ messages }) => ingestMessages(messages));
  }

  function get(contactId: string) {
    const row = getDb().prepare('SELECT contact_id, name, notify, verified_name, last_message_at FROM contacts WHERE contact_id = ?').get(contactId) as ContactRecord | undefined;
    return toContact(contactId, row);
  }

  function list(): ReturnType<typeof toContact>[] {
    return (getDb()
      .prepare('SELECT contact_id, name, notify, verified_name, last_message_at FROM contacts')
      .all() as unknown as ContactRecord[])
      .map((row) => toContact(row.contact_id, row));
  }

  return { attach, list, get };
}
