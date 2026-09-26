import { getDb } from '../store/db.js';

export const NON_INDIVIDUAL_JID_SUFFIXES = ['@g.us', '@broadcast'];

function formatJid(jid) {
  const [user] = jid.split('@');
  return user.startsWith('+') ? user : `+${user}`;
}

// COALESCE against the existing column, not a full overwrite, so a later
// partial (e.g. {id, notify} on every incoming message) never erases a
// fuller name/verifiedName an earlier event already found.
function upsert(entry) {
  getDb()
    .prepare(
      `INSERT INTO contacts (contact_id, name, notify, verified_name, updated_at)
       VALUES (@contactId, @name, @notify, @verifiedName, @updatedAt)
       ON CONFLICT (contact_id) DO UPDATE SET
         name = COALESCE(excluded.name, name),
         notify = COALESCE(excluded.notify, notify),
         verified_name = COALESCE(excluded.verified_name, verified_name),
         updated_at = excluded.updated_at`,
    )
    .run({ contactId: entry.id, name: entry.name ?? null, notify: entry.notify ?? null, verifiedName: entry.verifiedName ?? null, updatedAt: Date.now() });
}

function ingest(entries = []) {
  for (const entry of entries) {
    if (!entry?.id || NON_INDIVIDUAL_JID_SUFFIXES.some((suffix) => entry.id.endsWith(suffix))) continue;
    upsert(entry);
  }
}

function toContact(contactId, row) {
  const name = row?.name || row?.notify || row?.verified_name;
  return { id: contactId, name: name ?? formatJid(contactId) };
}

/**
 * Creates a SQLite-backed directory of every contact this account has ever
 * heard of, since @whiskeysockets/baileys 7.0.0-rc14 ships no built-in store
 * and only emits its one-time bulk sync ('messaging-history.set') on a
 * contact's very first login, never on a reconnect that reuses an existing
 * auth_info/ session. Persisting means a contact learned once (however that
 * happened) stays in the picker across restarts, and the roster fills in
 * cumulatively from three events, fullest-but-rare to partial-but-frequent:
 * 'messaging-history.set' (the phone's synced address book),
 * 'contacts.upsert' (bulk app-state sync), and 'contacts.update'
 * (incremental partials, notably {id, notify} on every incoming message
 * that carries a pushName).
 *
 * A contact who's never messaged and isn't in the phone's address book will
 * only ever have a bare JID — list()/get() fall back to a formatted JID so
 * callers never have to special-case a missing name.
 *
 * @returns {{
 *   attach: (sock: object) => void,
 *   list: () => { id: string, name: string }[],
 *   get: (contactId: string) => { id: string, name: string },
 * }}
 */
export function createContactDirectory() {
  function attach(sock) {
    sock.ev.on('messaging-history.set', ({ contacts: initial }) => ingest(initial));
    sock.ev.on('contacts.upsert', (entries) => ingest(entries));
    sock.ev.on('contacts.update', (entries) => ingest(entries));
  }

  function get(contactId) {
    const row = getDb().prepare('SELECT name, notify, verified_name FROM contacts WHERE contact_id = ?').get(contactId);
    return toContact(contactId, row);
  }

  function list() {
    return getDb()
      .prepare('SELECT contact_id, name, notify, verified_name FROM contacts ORDER BY updated_at ASC')
      .all()
      .map((row) => toContact(row.contact_id, row));
  }

  return { attach, list, get };
}
