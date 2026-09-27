import { getDb } from './db.ts';

export interface PhotoCacheEntry {
  url: string | null;
  fetchedAt: number | null;
}

interface PhotoCacheRow {
  photo_url: string | null;
  photo_fetched_at: number | null;
}

/**
 * Reads a contact's cached profile-photo lookup. Returns undefined when the
 * contact isn't in the directory at all — callers use that to refuse
 * looking up arbitrary JIDs the account has never actually heard of.
 */
export function getPhotoCache(contactId: string): PhotoCacheEntry | undefined {
  const row = getDb()
    .prepare('SELECT photo_url, photo_fetched_at FROM contacts WHERE contact_id = ?')
    .get(contactId) as PhotoCacheRow | undefined;
  return row && { url: row.photo_url, fetchedAt: row.photo_fetched_at };
}

// An UPDATE, never an upsert: a contact folded away or never ingested by
// the directory must not be resurrected by a late-finishing photo lookup.
export function setPhotoCache(contactId: string, url: string | null, fetchedAt: number): void {
  getDb().prepare('UPDATE contacts SET photo_url = ?, photo_fetched_at = ? WHERE contact_id = ?').run(url, fetchedAt, contactId);
}

export function invalidatePhotoCache(contactId: string): void {
  getDb().prepare('UPDATE contacts SET photo_fetched_at = NULL WHERE contact_id = ?').run(contactId);
}
