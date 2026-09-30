import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import { DEFAULT_STRIKE_LIMITS, strikeLimitsFromSettings, type StrikeLimits } from './strikeLimits';
import type { Setting } from './types';

export function useStrikeLimits(): StrikeLimits {
  const [limits, setLimits] = useState(DEFAULT_STRIKE_LIMITS);

  useEffect(() => {
    let cancelled = false;

    function refresh() {
      apiFetch<Setting[]>('/api/settings')
        .then((settings) => {
          if (!cancelled) setLimits(strikeLimitsFromSettings(settings));
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

  return limits;
}
