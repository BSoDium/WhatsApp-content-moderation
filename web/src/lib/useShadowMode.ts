import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import type { Setting } from './types';

const SHADOW_MODE_KEY = 'SHADOW_MODE';

// `shadowMode` is false until the first response, so the banner never flashes on for a deployment that has it off.
export function useShadowMode(): { shadowMode: boolean; settled: boolean } {
  const [shadowMode, setShadowMode] = useState(false);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let cancelled = false;

    function refresh() {
      apiFetch<Setting[]>('/api/settings')
        .then((settings) => {
          const setting = settings.find((s) => s.key === SHADOW_MODE_KEY);
          if (!cancelled && setting) setShadowMode(setting.value === '1');
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setSettled(true);
        });
    }

    refresh();
    const events = new EventSource('/api/events');
    events.onmessage = (event) => {
      if (event.data === 'settings') refresh();
    };
    return () => {
      cancelled = true;
      events.close();
    };
  }, []);

  return { shadowMode, settled };
}
