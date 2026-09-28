import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from './api';
import type { Stats } from './types';

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
  // an audit-log event) never flips loading back to true and flashes skeletons over real data.
  const hasLoadedOnce = useRef(false);

  const refresh = useCallback(async function refresh() {
    if (!hasLoadedOnce.current) setLoading(true);
    try {
      const result = await apiFetch<Stats>('/api/stats');
      setStats(result);
      setError(null);
      hasLoadedOnce.current = true;
    } catch (err: unknown) {
      // Deliberately leave `stats` untouched: a transient blip on a background refresh
      // shouldn't blank out numbers the operator was already looking at.
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const events = new EventSource('/api/events');
    events.onmessage = (event) => {
      if (event.data === 'audit-log') refresh();
    };
    return () => events.close();
  }, [refresh]);

  return { stats, loading, error, refresh };
}
