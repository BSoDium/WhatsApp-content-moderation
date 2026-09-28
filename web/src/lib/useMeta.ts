import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import type { Meta } from './types';

// Fetched once at mount, not kept live via SSE — authRequired is fixed for
// the process's lifetime (it mirrors whether ALLOWED_TAILSCALE_LOGIN was set
// at startup), so there's nothing for another tab to change mid-session.
export function useMeta(): Meta | null {
  const [meta, setMeta] = useState<Meta | null>(null);

  useEffect(() => {
    apiFetch<Meta>('/api/meta')
      .then(setMeta)
      .catch(() => {});
  }, []);

  return meta;
}
