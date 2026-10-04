import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './api';
import type { Contact, ControlError, OverrideCommand, RosterEntry } from './types';

// Fallback for what the SSE stream misses, so it can be far slower than a real poll.
const FALLBACK_POLL_MS = 30_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Controlled inputs read straight from state, so a failed mutation never applies the optimistic change.
export function useControlData(initialSelectedId: string | null = null) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoaded, setContactsLoaded] = useState(false);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [error, setError] = useState<ControlError | null>(null);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [streamLive, setStreamLive] = useState(false);

  // Named function expressions, not bare arrows, so a retry closure can call the in-progress function by name.
  const refreshContacts = useCallback(async function refreshContacts() {
    try {
      setContacts(await apiFetch<Contact[]>('/api/contacts'));
      setLastRefreshedAt(Date.now());
    } catch (error: unknown) {
      setError({ title: 'Could not load contacts', description: errorMessage(error), retry: refreshContacts });
    } finally {
      setContactsLoaded(true);
    }
  }, []);

  const refreshRoster = useCallback(async function refreshRoster() {
    try {
      setRoster(await apiFetch<RosterEntry[]>('/api/roster'));
      setLastRefreshedAt(Date.now());
    } catch (error: unknown) {
      setError({ title: "Couldn't reach the server", description: errorMessage(error), retry: refreshRoster });
    }
  }, []);

  useEffect(() => {
    // Both refreshes catch their own errors, so an initial fetch failure still counts as settled.
    Promise.all([refreshContacts(), refreshRoster()]).then(() => setInitialLoadComplete(true));

    const events = new EventSource('/api/events');
    events.onopen = () => setStreamLive(true);
    events.onerror = () => setStreamLive(false);
    events.onmessage = (event) => {
      if (event.data === 'contacts') refreshContacts();
      else if (event.data === 'roster') {
        // Strikes and blocks of contacts that aren't on the roster only exist in the contacts feed.
        refreshRoster();
        refreshContacts();
      } else if (event.data === 'settings') refreshRoster();
    };

    const id = setInterval(() => {
      refreshContacts();
      refreshRoster();
    }, FALLBACK_POLL_MS);
    return () => {
      events.close();
      clearInterval(id);
    };
  }, [refreshContacts, refreshRoster]);

  const setMonitored = useCallback(
    async function setMonitored(contactId: string, monitored: boolean): Promise<void> {
      try {
        if (monitored) {
          await apiFetch('/api/roster', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contactId }),
          });
        } else {
          await apiFetch(`/api/roster/${encodeURIComponent(contactId)}`, { method: 'DELETE' });
        }
        setError(null);
        // Not refreshContacts() too: nothing reads /api/contacts' `monitored` field — ContactList derives it from `roster` instead.
        await refreshRoster();
      } catch (error: unknown) {
        setError({ title: 'Could not update moderation', description: errorMessage(error), retry: () => setMonitored(contactId, monitored) });
      }
    },
    [refreshRoster],
  );

  const runCommand = useCallback(
    async function runCommand(contactId: string, action: OverrideCommand): Promise<string | undefined> {
      try {
        const result = await apiFetch<{ message: string | null }>(`/api/roster/${encodeURIComponent(contactId)}/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        setError(null);
        await Promise.all([refreshRoster(), refreshContacts()]);
        return result.message ?? '';
      } catch (error: unknown) {
        setError({ title: 'Command failed', description: errorMessage(error), retry: async () => { await runCommand(contactId, action); } });
        return undefined;
      }
    },
    [refreshRoster, refreshContacts],
  );

  const setEscalation = useCallback(
    async function setEscalation(contactId: string, enabled: boolean): Promise<void> {
      try {
        await apiFetch(`/api/roster/${encodeURIComponent(contactId)}/escalation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled }),
        });
        setError(null);
        await refreshRoster();
      } catch (error: unknown) {
        setError({ title: 'Could not update escalation', description: errorMessage(error), retry: () => setEscalation(contactId, enabled) });
      }
    },
    [refreshRoster],
  );

  // Rejects with a message instead of only feeding the shared banner, so the Save button can show a field-local error.
  const setContext = useCallback(
    async function setContext(contactId: string, context: string): Promise<true> {
      try {
        await apiFetch(`/api/roster/${encodeURIComponent(contactId)}/context`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ context }),
        });
        await refreshRoster();
        return true;
      } catch (error: unknown) {
        throw new Error(errorMessage(error));
      }
    },
    [refreshRoster],
  );

  // Same throw-on-failure contract as setContext above, for the same reason: ContactDetailPanel's own save-on-blur field state needs the failure itself, not just the shared banner.
  const setCallNuisanceThreshold = useCallback(
    async function setCallNuisanceThreshold(contactId: string, threshold: number | null): Promise<true> {
      try {
        await apiFetch(`/api/roster/${encodeURIComponent(contactId)}/call-nuisance-threshold`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ threshold }),
        });
        await refreshRoster();
        return true;
      } catch (error: unknown) {
        throw new Error(errorMessage(error));
      }
    },
    [refreshRoster],
  );

  const setBlockBackoffMax = useCallback(
    async function setBlockBackoffMax(contactId: string, maxDurationMs: number | null): Promise<true> {
      try {
        await apiFetch(`/api/roster/${encodeURIComponent(contactId)}/block-backoff-max`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ maxDurationMs }),
        });
        await refreshRoster();
        return true;
      } catch (error: unknown) {
        throw new Error(errorMessage(error));
      }
    },
    [refreshRoster],
  );

  const dismissError = useCallback(() => setError(null), []);

  return {
    contacts,
    contactsLoaded,
    roster,
    selectedId,
    setSelectedId,
    error,
    dismissError,
    setMonitored,
    runCommand,
    setEscalation,
    setContext,
    setCallNuisanceThreshold,
    setBlockBackoffMax,
    initialLoadComplete,
    lastRefreshedAt,
    streamLive,
  };
}
