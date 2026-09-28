import { jidNormalizedUser } from '@whiskeysockets/baileys';
import { eq, sql } from 'drizzle-orm';
import { getOrm } from '../store/db.ts';
import { emitControlEvent } from '../store/events.ts';
import { excluded } from '../store/excluded.ts';
import { invalidatePhotoCache } from '../store/contact-photos.ts';
import { contacts } from '../store/schema.ts';
import type { Chat, Contact, WAMessage, WASocket } from '@whiskeysockets/baileys';
import type { SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { ContactRecord } from '../types.ts';

interface ContactEntry extends Omit<Partial<Contact>, 'lid' | 'name' | 'notify' | 'verifiedName'> {
  id: string;
  name?: string | null;
  notify?: string | null;
  verifiedName?: string | null;
  lid?: string | null;
  lastMessageAt?: number | null;
  photoUrl?: string | null;
  photoFetchedAt?: number | null;
}

// @newsletter is WhatsApp Channels — not a DM, and not something the
// delete/warn/block pipeline (built around a real two-way chat) supports.
export const NON_INDIVIDUAL_JID_SUFFIXES = ['@g.us', '@broadcast', '@newsletter'];

const CONTACT_RECORD_COLUMNS = {
  contact_id: contacts.contact_id,
  name: contacts.name,
  notify: contacts.notify,
  verified_name: contacts.verified_name,
  lid: contacts.lid,
  last_message_at: contacts.last_message_at,
};

function formatJid(jid: string): string {
  const [user] = jid.split('@');
  return user.startsWith('+') ? user : `+${user}`;
}

function isLid(jid: string): boolean {
  return jid.endsWith('@lid');
}

// sock.user.id (used to identify the self contact) commonly still carries
// the account's own device suffix (e.g. "...:31@s.whatsapp.net"), unlike
// every JID this module otherwise sees from contacts.*/messages.* events,
// which Baileys already normalizes without one — so a bare string compare
// against a directory row silently never matches. jidNormalizedUser() is a
// no-op on an already-bare JID, so normalizing everything through here is
// always safe.
function normalizeJid(jid: string): string {
  return jidNormalizedUser(jid) || jid;
}

// Baileys assigns every contact a stable @lid identity alongside their
// phone-number JID as part of WhatsApp's ongoing privacy migration (see also
// the self-chat @lid note in README "Quick start"). The two forms surface
// from different events — a full Contact record sometimes knows both ends
// (.lid/.phoneNumber), a message key gets the pairing filled in once Baileys
// resolves it (key.remoteJidAlt) — and without reconciling them the same
// person ends up as two directory rows, typically with different names (the
// address book's `name` lands on whichever form got the fuller sync, a bare
// `notify` pushname on the other). Always prefers the phone-number form as
// the canonical contact_id — formatJid()'s fallback and the rest of this
// app's JID handling already assume that shape.
function reconcileJid(id: string, altId?: string | null): { canonicalId: string; lid: string | null } {
  const forms = altId && altId !== id ? [id, altId] : [id];
  const lidForm = forms.find(isLid);
  const pnForm = forms.find((jid) => !isLid(jid));
  const canonicalId = pnForm ?? id;
  const lid = lidForm && lidForm !== canonicalId ? lidForm : null;
  return { canonicalId, lid };
}

// A lid learned from an earlier event (recorded on its row's `lid` column)
// lets a later lid-only event — e.g. a bare {id: <lid>, notify}
// contacts.update, which never carries the phoneNumber counterpart itself —
// still resolve to the same canonical row instead of creating a second one.
function lookupCanonicalForLid(lid: string): string | undefined {
  const row = getOrm().select({ contact_id: contacts.contact_id }).from(contacts).where(eq(contacts.lid, lid)).get();
  return row?.contact_id;
}

// Shared by ingestOne() and canonicalContactId(): resolves the "other JID
// form" for a normalized id, falling back to a mapping this module already
// learned (via lookupCanonicalForLid) when the caller doesn't hand us one
// directly — e.g. sock.user often exposes only a bare @lid with no
// populated .phoneNumber, even though some other event already taught the
// directory that lid's phone-number pairing.
function resolveAltId(id: string, direct: string | undefined): string | undefined {
  if (direct) return normalizeJid(direct);
  return isLid(id) ? lookupCanonicalForLid(id) : undefined;
}

// Resolves a Baileys Contact-like object's canonical (phone-number) JID the
// same way ingest() reconciles the directory — used by index.ts to identify
// the logged-in account's own contact_id (`sock.user`) so the control app
// can recognize and disable self-moderation, without a second, divergent
// notion of "canonical" living outside this module.
export function canonicalContactId({ id, lid, phoneNumber }: { id: string; lid?: string | null; phoneNumber?: string | null }): string {
  const normalizedId = normalizeJid(id);
  return reconcileJid(normalizedId, resolveAltId(normalizedId, phoneNumber || lid || undefined)).canonicalId;
}

// Same reconciliation, for a live message's key — used by index.ts's
// messages.upsert handler so isMonitored()/strikes/audit-log routing agrees
// with whatever id a contact was actually added to the roster under (the
// canonicalized form contactDirectory.list() returns), rather than
// whichever raw JID form this particular message happened to be addressed
// by. Without this, a contact added under their phone-number JID never
// matches a message that arrives addressed via @lid (or vice versa) — the
// roster lookup silently misses and the message is dropped before
// classification ever runs.
export function canonicalMessageContactId(key: { remoteJid?: string | null; remoteJidAlt?: string | null }): string | null {
  if (!key.remoteJid) return null;
  const id = normalizeJid(key.remoteJid);
  return reconcileJid(id, resolveAltId(id, key.remoteJidAlt || undefined)).canonicalId;
}

function coalesceExisting(column: SQLiteColumn): SQL {
  return sql`COALESCE(${excluded(column)}, ${column})`;
}

// A cached photo lookup is one (url, fetched_at) pair (a null url means "no photo" only alongside its fetched_at), so both columns take the incoming folded alias's pair only when it's newer, never mixing two lookups.
function newerPhotoLookup(column: SQLiteColumn): SQL {
  return sql`CASE
    WHEN ${excluded(contacts.photo_fetched_at)} IS NOT NULL
      AND (${contacts.photo_fetched_at} IS NULL OR ${excluded(contacts.photo_fetched_at)} > ${contacts.photo_fetched_at})
    THEN ${excluded(column)}
    ELSE ${column}
  END`;
}

// COALESCE against the existing name/notify/verifiedName/lid columns, not a
// full overwrite, so a later partial (e.g. {id, notify} on every incoming
// message) never erases a fuller name an earlier event already found.
// last_message_at instead takes the MAX of old vs incoming, since two real
// timestamps should keep the more recent one regardless of event order,
// and a touch that doesn't know a timestamp (a pure name-sync event) must
// leave it untouched rather than clearing it. Only foldAlias() ever passes a
// photo lookup; every other ingest leaves the cached one alone.
function upsert(entry: ContactEntry): void {
  getOrm()
    .insert(contacts)
    .values({
      contact_id: entry.id,
      // `|| null`, not `?? null`: an empty string must COALESCE the same as
      // a missing field (SQLite's COALESCE treats '' as non-null and would
      // otherwise let it erase a previously-found name).
      name: entry.name || null,
      notify: entry.notify || null,
      verified_name: entry.verifiedName || null,
      lid: entry.lid || null,
      last_message_at: entry.lastMessageAt ?? null,
      photo_url: entry.photoUrl ?? null,
      photo_fetched_at: entry.photoFetchedAt ?? null,
      updated_at: Date.now(),
    })
    .onConflictDoUpdate({
      target: contacts.contact_id,
      set: {
        name: coalesceExisting(contacts.name),
        notify: coalesceExisting(contacts.notify),
        verified_name: coalesceExisting(contacts.verified_name),
        lid: coalesceExisting(contacts.lid),
        last_message_at: sql`CASE
          WHEN ${excluded(contacts.last_message_at)} IS NULL THEN ${contacts.last_message_at}
          WHEN ${contacts.last_message_at} IS NULL THEN ${excluded(contacts.last_message_at)}
          ELSE MAX(${contacts.last_message_at}, ${excluded(contacts.last_message_at)})
        END`,
        photo_url: newerPhotoLookup(contacts.photo_url),
        photo_fetched_at: newerPhotoLookup(contacts.photo_fetched_at),
        updated_at: excluded(contacts.updated_at),
      },
    })
    .run();
  emitControlEvent('contacts');
}

// Folds a stale row — kept under a JID form now known to be the same person
// as `canonicalId` — into the canonical row, then removes it, so the
// directory shows one entry instead of two however late the lid<->pn
// pairing arrives.
function foldAlias(canonicalId: string, aliasId: string | null | undefined): void {
  if (!aliasId || aliasId === canonicalId) return;
  const stale = getOrm()
    .select({
      name: contacts.name,
      notify: contacts.notify,
      verified_name: contacts.verified_name,
      last_message_at: contacts.last_message_at,
      photo_url: contacts.photo_url,
      photo_fetched_at: contacts.photo_fetched_at,
    })
    .from(contacts)
    .where(eq(contacts.contact_id, aliasId))
    .get();
  if (!stale) return;
  upsert({
    id: canonicalId,
    name: stale.name,
    notify: stale.notify,
    verifiedName: stale.verified_name,
    lastMessageAt: stale.last_message_at,
    photoUrl: stale.photo_url,
    photoFetchedAt: stale.photo_fetched_at,
  });
  getOrm().delete(contacts).where(eq(contacts.contact_id, aliasId)).run();
}

function ingestOne(rawId: string, rawAltId: string | undefined, rest: Partial<Contact> & { lastMessageAt?: number | null }): string | null {
  if (NON_INDIVIDUAL_JID_SUFFIXES.some((suffix) => rawId.endsWith(suffix))) return null;

  const id = normalizeJid(rawId);
  const { canonicalId, lid } = reconcileJid(id, resolveAltId(id, rawAltId));
  // Either side of the pairing might already have its own stale row from
  // before this event taught us they're the same person — fold both.
  if (lid && lid !== id) foldAlias(canonicalId, lid);
  if (id !== canonicalId) foldAlias(canonicalId, id);

  upsert({ ...rest, id: canonicalId, lid });
  return canonicalId;
}

// Baileys turns WhatsApp's `picture` notification into a contacts.update
// carrying one of these sentinel imgUrl values (a real URL string elsewhere
// in the Contact type means something else), so a contact's new or removed
// photo shows up without waiting out profile-photos.ts's refresh window.
const PHOTO_CHANGE_MARKERS = new Set(['changed', 'removed']);

function ingest(entries: Array<Partial<Contact> & { id?: string; lastMessageAt?: number | null }> = []): void {
  for (const entry of entries) {
    if (typeof entry.id !== 'string') continue;
    const contactId = ingestOne(entry.id, entry.phoneNumber || entry.lid || undefined, entry);
    if (contactId && entry.imgUrl && PHOTO_CHANGE_MARKERS.has(entry.imgUrl)) invalidatePhotoCache(contactId);
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
  for (const msg of messages) {
    const id = msg.key?.remoteJid;
    if (!id) continue;
    ingestOne(id, msg.key.remoteJidAlt || undefined, {
      lastMessageAt: msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : null,
    });
  }
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
 * Every ingest path also reconciles a contact's @lid identity against their
 * phone-number JID (reconcileJid()/foldAlias()) so the same person never
 * shows up twice just because different events named them differently.
 *
 * A contacts.update announcing a changed/removed profile photo invalidates
 * that contact's cached photo lookup (see src/whatsapp/profile-photos.ts).
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
    // WhatsApp's own lid<->phone-number pairing channel, independent of any message ever being exchanged — without this, a contact whose first-ever interaction is a call (not a message) can stay unresolved to their phone-number-keyed roster row.
    sock.ev.on('lid-mapping.update', ({ pn, lid }) => ingest([{ id: pn, lid }]));
  }

  function get(contactId: string) {
    return toContact(contactId, getOrm().select(CONTACT_RECORD_COLUMNS).from(contacts).where(eq(contacts.contact_id, contactId)).get());
  }

  function list(): ReturnType<typeof toContact>[] {
    return getOrm()
      .select(CONTACT_RECORD_COLUMNS)
      .from(contacts)
      .all()
      .map((row) => toContact(row.contact_id, row));
  }

  return { attach, list, get };
}
