import type { AuditLogEntry } from './types';

/**
 * Folds a freshly fetched first page into the entries already on screen:
 * the latest page leads (it may carry edits to rows already shown) and any
 * older rows the user paged in stay put, so a live update never shrinks the
 * list under their scroll position.
 */
export function mergeLatestEntries(current: AuditLogEntry[], latest: AuditLogEntry[]): AuditLogEntry[] {
  const latestIds = new Set(latest.map((entry) => entry.id));
  return [...latest, ...current.filter((entry) => !latestIds.has(entry.id))];
}
