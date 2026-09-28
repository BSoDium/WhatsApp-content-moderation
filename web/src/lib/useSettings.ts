import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from './api';
import type { Setting } from './types';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface UseOpenOptions {
  open: boolean;
}

// Distinct title per failure (load vs. save) so the banner names what
// actually went wrong instead of always reading like a fetch failure.
interface SettingsError {
  title: string;
  description: string;
}

// Fetches on open (remounted via a `key` in App.tsx, same as ActivityPanel)
// and stays live via SSE while open, so an edit from another tab shows up
// without reopening this one.
export function usePolicy({ open }: UseOpenOptions) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<SettingsError | null>(null);
  const opened = useRef(false);

  const refresh = useCallback(async function refresh() {
    setLoading(true);
    try {
      const result = await apiFetch<{ text: string }>('/api/policy');
      setText(result.text);
      setError(null);
    } catch (err: unknown) {
      setError({ title: 'Could not load the policy', description: errorMessage(err) });
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
      setError({ title: 'Could not save the policy', description: errorMessage(err) });
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

const SAVED_CONFIRMATION_MS = 2500;

export type SaveStatus = 'idle' | 'saving' | 'saved';

export function useSettingsList({ open }: UseOpenOptions) {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<SettingsError | null>(null);
  const [pendingKeys, setPendingKeys] = useState(() => new Set<string>());
  const [savedVisible, setSavedVisible] = useState(false);
  const savedTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const opened = useRef(false);
  const hasLoaded = useRef(false);

  const refresh = useCallback(async function refresh() {
    // Only the first load swaps the list for a loading state; a background refresh would unmount every section and reset the scroll position.
    if (!hasLoaded.current) setLoading(true);
    try {
      setSettings(await apiFetch<Setting[]>('/api/settings'));
      hasLoaded.current = true;
      setError(null);
    } catch (err: unknown) {
      setError({ title: 'Could not load settings', description: errorMessage(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  const save = useCallback(
    async function save(key: string, value: string): Promise<boolean> {
      clearTimeout(savedTimeout.current);
      setSavedVisible(false);
      setPendingKeys((prev) => new Set(prev).add(key));
      try {
        await apiFetch(`/api/settings/${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value }),
        });
        setError(null);
        await refresh();
        setSavedVisible(true);
        savedTimeout.current = setTimeout(() => setSavedVisible(false), SAVED_CONFIRMATION_MS);
        return true;
      } catch (err: unknown) {
        const label = settings.find((s) => s.key === key)?.label ?? key;
        setError({ title: `Could not save "${label}"`, description: errorMessage(err) });
        return false;
      } finally {
        setPendingKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [refresh, settings],
  );

  useEffect(() => () => clearTimeout(savedTimeout.current), []);

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

  const saveStatus: SaveStatus = pendingKeys.size > 0 ? 'saving' : savedVisible ? 'saved' : 'idle';

  return { settings, loading, error, pendingKeys, saveStatus, refresh, save };
}
