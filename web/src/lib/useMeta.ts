import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import type { Meta } from './types';

// Fetched once: authRequired is fixed for the process lifetime.
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
