import type { AuditLogEntry } from './types';

/**
 * Folds a freshly fetched first page into the entries already on screen: the
 * latest page leads and any older rows the user paged in stay put, so a live
 * update never shrinks the list under their scroll position. Shown rows the
 * page covers (as new as its oldest entry) but didn't return are dropped, as
 * they were removed or no longer match the filters; when `complete` is true
 * the page is everything there is, so it replaces the list outright.
 */
export function mergeLatestEntries(current: AuditLogEntry[], latest: AuditLogEntry[], complete: boolean): AuditLogEntry[] {
  if (complete || latest.length === 0) return latest;
  const oldestCovered = latest[latest.length - 1].id;
  return [...latest, ...current.filter((entry) => entry.id < oldestCovered)];
}
