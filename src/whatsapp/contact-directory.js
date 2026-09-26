const NON_INDIVIDUAL_JID_SUFFIXES = ['@g.us', '@broadcast'];

function formatJid(jid) {
  const [user] = jid.split('@');
  return user.startsWith('+') ? user : `+${user}`;
}

/**
 * Creates a greenfield, in-memory directory of every contact this account
 * has ever heard of, since @whiskeysockets/baileys 7.0.0-rc14 ships no
 * built-in store. Backed by three events, from fullest-but-rare to
 * partial-but-frequent: 'messaging-history.set' (once, right after login,
 * the phone's synced address book), 'contacts.upsert' (bulk app-state
 * sync), and 'contacts.update' (incremental partials — notably {id, notify}
 * on every incoming message that carries a pushName, which is how even a
 * never-synced contact gets a name once they message in). Partial updates
 * are merged into any existing entry rather than overwriting it, so a later
 * partial never erases a fuller name an earlier event already found.
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
  const contacts = new Map();

  function ingest(entries = []) {
    for (const entry of entries) {
      if (!entry?.id || NON_INDIVIDUAL_JID_SUFFIXES.some((suffix) => entry.id.endsWith(suffix))) continue;
      contacts.set(entry.id, { ...contacts.get(entry.id), ...entry, id: entry.id });
    }
  }

  function attach(sock) {
    sock.ev.on('messaging-history.set', ({ contacts: initial }) => ingest(initial));
    sock.ev.on('contacts.upsert', (entries) => ingest(entries));
    sock.ev.on('contacts.update', (entries) => ingest(entries));
  }

  function get(contactId) {
    const entry = contacts.get(contactId);
    const name = entry?.name || entry?.notify || entry?.verifiedName;
    return { id: contactId, name: name ?? formatJid(contactId) };
  }

  function list() {
    return Array.from(contacts.keys()).map(get);
  }

  return { attach, list, get };
}
