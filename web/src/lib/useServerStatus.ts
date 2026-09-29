import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import type { ServerStatus } from './types';

const POLL_MS = 5_000;

export function useServerStatus(): { status: ServerStatus | null; failed: boolean } {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      apiFetch<ServerStatus>('/api/status')
        .then((next) => {
          if (cancelled) return;
          setStatus(next);
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

  return { status, failed };
}
