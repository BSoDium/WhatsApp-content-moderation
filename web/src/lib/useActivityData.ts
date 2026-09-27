import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from './api';
import type { AuditLogEntry, AuditLogPage, Stats } from './types';

const SEARCH_DEBOUNCE_MS = 300;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  return search.toString();
}

interface UseActivityDataOptions {
  open: boolean;
  initialContactId: string | null;
}

// Fetches fresh whenever the sheet opens (mounted via a remount-on-open `key`
// in App.tsx, mirroring ContactDetailPanel's own key-to-reset-state pattern)
// and whenever a filter changes. `search` is debounced so fast typing doesn't
// fire a request per keystroke; contactId/action (both Selects, not typed)
// refetch immediately.
export function useActivityData({ open, initialContactId }: UseActivityDataOptions) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [contactId, setContactId] = useState(initialContactId ?? '');
  const [action, setAction] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped by every fetch-initiating call (refresh or loadMore) and checked before
  // applying a response — filter changes fire requests faster than they can be
  // guaranteed to resolve in order, and an older response landing after a newer
  // one must never clobber it.
  const requestSeq = useRef(0);

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchInput]);

  const fetchPage = useCallback(
    (before?: number) => apiFetch<AuditLogPage>(`/api/audit-log?${buildQuery({ contactId, action, search, before })}`),
    [contactId, action, search],
  );

  const refresh = useCallback(async function refresh() {
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const [statsResult, page] = await Promise.all([apiFetch<Stats>('/api/stats'), fetchPage()]);
      if (seq !== requestSeq.current) return;
      setStats(statsResult);
      setEntries(page.entries);
      setNextBefore(page.nextBefore);
      setError(null);
    } catch (err: unknown) {
      if (seq !== requestSeq.current) return;
      setError(errorMessage(err));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [fetchPage]);

  const loadMore = useCallback(async function loadMore() {
    if (nextBefore === null) return;
    const seq = ++requestSeq.current;
    setLoadingMore(true);
    try {
      const page = await fetchPage(nextBefore);
      if (seq !== requestSeq.current) return;
      setEntries((prev) => [...prev, ...page.entries]);
      setNextBefore(page.nextBefore);
      setError(null);
    } catch (err: unknown) {
      if (seq !== requestSeq.current) return;
      setError(errorMessage(err));
    } finally {
      if (seq === requestSeq.current) setLoadingMore(false);
    }
  }, [fetchPage, nextBefore]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  return {
    stats,
    entries,
    nextBefore,
    loading,
    loadingMore,
    error,
    contactId,
    setContactId,
    action,
    setAction,
    searchInput,
    setSearchInput,
    refresh,
    loadMore,
  };
}
