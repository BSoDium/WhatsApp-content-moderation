import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import type { Setting } from './types';

const SHADOW_MODE_KEY = 'SHADOW_MODE';

// null until the first response, so the banner never flashes on for a deployment that has it off.
export function useShadowMode(): boolean | null {
  const [shadowMode, setShadowMode] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    function refresh() {
      apiFetch<Setting[]>('/api/settings')
        .then((settings) => {
          const setting = settings.find((s) => s.key === SHADOW_MODE_KEY);
          if (!cancelled && setting) setShadowMode(setting.value === '1');
        })
        .catch(() => {});
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

  return shadowMode;
}
