import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from './api';
import type { Setting } from './types';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface UseOpenOptions {
  open: boolean;
}

// Fetches on open (remounted via a `key` in App.tsx, same as ActivityPanel)
// and stays live via SSE while open, so an edit from another tab shows up
// without reopening this one.
export function usePolicy({ open }: UseOpenOptions) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opened = useRef(false);

  const refresh = useCallback(async function refresh() {
    setLoading(true);
    try {
      const result = await apiFetch<{ text: string }>('/api/policy');
      setText(result.text);
      setError(null);
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const save = useCallback(async function save(nextText: string): Promise<boolean> {
    setSaving(true);
    try {
      const result = await apiFetch<{ text: string }>('/api/policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: nextText }),
      });
      setText(result.text);
      setError(null);
      return true;
    } catch (err: unknown) {
      setError(errorMessage(err));
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  useEffect(() => {
    if (!open || opened.current) return;
    opened.current = true;
    refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const events = new EventSource('/api/events');
    events.onmessage = (event) => {
      if (event.data === 'policy') refresh();
    };
    return () => events.close();
  }, [open, refresh]);

  return { text, loading, saving, error, refresh, save };
}

// Same shape as usePolicy above, but for the tunables list — save() takes
// the specific key being edited, and pendingKeys tracks in-flight saves
// per-row so one field's save state never disables another.
export function useSettingsList({ open }: UseOpenOptions) {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingKeys, setPendingKeys] = useState(() => new Set<string>());
  const opened = useRef(false);

  const refresh = useCallback(async function refresh() {
    setLoading(true);
    try {
      setSettings(await apiFetch<Setting[]>('/api/settings'));
      setError(null);
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const save = useCallback(
    async function save(key: string, value: string): Promise<boolean> {
      setPendingKeys((prev) => new Set(prev).add(key));
      try {
        await apiFetch(`/api/settings/${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value }),
        });
        setError(null);
        await refresh();
        return true;
      } catch (err: unknown) {
        setError(errorMessage(err));
        return false;
      } finally {
        setPendingKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [refresh],
  );

  useEffect(() => {
    if (!open || opened.current) return;
    opened.current = true;
    refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const events = new EventSource('/api/events');
    events.onmessage = (event) => {
      if (event.data === 'settings') refresh();
    };
    return () => events.close();
  }, [open, refresh]);

  return { settings, loading, error, pendingKeys, refresh, save };
}
