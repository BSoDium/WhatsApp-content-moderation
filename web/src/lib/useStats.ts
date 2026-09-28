import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from './api';
import type { Stats } from './types';

// Block/unblock paths emit 'roster' rather than a block-specific topic, so these two
// cover every /api/stats field; 'contacts', 'settings' and 'policy' never change them.
const STATS_TOPICS = new Set(['roster', 'audit-log']);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Independent of the Activity panel's useActivityData — this powers the always-visible
// compact overview row, so it fetches and subscribes to /api/events on its own lifecycle.
export function useOverviewStats() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Tracks whether a fetch has ever succeeded, so a later background refresh (triggered by
  // an SSE event) never flips loading back to true and flashes skeletons over real data.
  const hasLoadedOnce = useRef(false);
  // A burst of SSE events fires overlapping refreshes that can resolve out of order; an
  // older response landing after a newer one must never clobber it.
  const requestSeq = useRef(0);

  const refresh = useCallback(async function refresh() {
    const seq = ++requestSeq.current;
    if (!hasLoadedOnce.current) setLoading(true);
    try {
      const result = await apiFetch<Stats>('/api/stats');
      if (seq !== requestSeq.current) return;
      setStats(result);
      setError(null);
      hasLoadedOnce.current = true;
    } catch (err: unknown) {
      if (seq !== requestSeq.current) return;
      // Deliberately leave `stats` untouched: a transient blip on a background refresh
      // shouldn't blank out numbers the operator was already looking at.
      setError(errorMessage(err));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const events = new EventSource('/api/events');
    events.onmessage = (event) => {
      if (STATS_TOPICS.has(event.data)) refresh();
    };
    return () => events.close();
  }, [refresh]);

  return { stats, loading, error, refresh };
}
