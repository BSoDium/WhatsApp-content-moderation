import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import type { Meta } from './types';

// Fetched once at mount, not kept live via SSE — authRequired is fixed for
// the process's lifetime (it mirrors whether ALLOWED_TAILSCALE_LOGIN was set
// at startup), so there's nothing for another tab to change mid-session.
export function useMeta(): { meta: Meta | null; settled: boolean } {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    apiFetch<Meta>('/api/meta')
      .then(setMeta)
      .catch(() => {})
      .finally(() => setSettled(true));
  }, []);

  return { meta, settled };
}
