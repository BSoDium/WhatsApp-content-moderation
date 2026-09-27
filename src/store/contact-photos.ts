import { eq } from 'drizzle-orm';
import { getOrm } from './db.ts';
import { contacts } from './schema.ts';

export interface PhotoCacheEntry {
  url: string | null;
  fetchedAt: number | null;
}

/**
 * Reads a contact's cached profile-photo lookup. Returns undefined when the
 * contact isn't in the directory at all — callers use that to refuse
 * looking up arbitrary JIDs the account has never actually heard of.
 */
export function getPhotoCache(contactId: string): PhotoCacheEntry | undefined {
  const row = getOrm()
    .select({ photo_url: contacts.photo_url, photo_fetched_at: contacts.photo_fetched_at })
    .from(contacts)
    .where(eq(contacts.contact_id, contactId))
    .get();
  return row && { url: row.photo_url, fetchedAt: row.photo_fetched_at };
}

// An UPDATE, never an upsert: a contact folded away or never ingested by
// the directory must not be resurrected by a late-finishing photo lookup.
export function setPhotoCache(contactId: string, url: string | null, fetchedAt: number): void {
  getOrm().update(contacts).set({ photo_url: url, photo_fetched_at: fetchedAt }).where(eq(contacts.contact_id, contactId)).run();
}

export function invalidatePhotoCache(contactId: string): void {
  getOrm().update(contacts).set({ photo_fetched_at: null }).where(eq(contacts.contact_id, contactId)).run();
}
