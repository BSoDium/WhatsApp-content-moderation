import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import type { ServerStatus } from './types';

const POLL_MS = 5_000;

// Server timestamps are compared against the browser clock, so `clockSkewMs` (server minus local, taken at fetch time) has to be added to `Date.now()` before subtracting one.
export function useServerStatus(): { status: ServerStatus | null; failed: boolean; clockSkewMs: number } {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [clockSkewMs, setClockSkewMs] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      apiFetch<ServerStatus>('/api/status')
        .then((next) => {
          if (cancelled) return;
          setStatus(next);
          setClockSkewMs(next.serverTime - Date.now());
          setFailed(false);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { status, failed, clockSkewMs };
}
