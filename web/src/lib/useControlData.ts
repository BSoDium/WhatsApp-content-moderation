import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './api';
import type { Contact, ControlError, OverrideCommand, RosterEntry } from './types';

// Belt-and-suspenders fallback for whatever the SSE connection below misses
// (a dropped connection between EventSource's own reconnect attempts) — the
// stream is the primary path, so this can be far slower than a real poll.
const FALLBACK_POLL_MS = 30_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Controlled Switch/inputs read straight from contacts/roster state, so a failed mutation never applies the optimistic change React already rendered.
// `initialSelectedId` seeds the selection from the URL (App.tsx) so a page
// refresh reopens the same contact instead of landing back on the bare list.
export function useControlData(initialSelectedId: string | null = null) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoaded, setContactsLoaded] = useState(false);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [error, setError] = useState<ControlError | null>(null);
  // Flips once after the first fetch of both contacts and roster settles, so
  // ContactList can skip its reorder animation for that initial population
  // and only animate moderation changes that happen afterwards.
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);

  // Named function expressions, not bare arrows, so a retry closure can call the in-progress function by name.
  const refreshContacts = useCallback(async function refreshContacts() {
    try {
      setContacts(await apiFetch<Contact[]>('/api/contacts'));
    } catch (error: unknown) {
      setError({ title: 'Could not load contacts', description: errorMessage(error), retry: refreshContacts });
    } finally {
      setContactsLoaded(true);
    }
  }, []);

  const refreshRoster = useCallback(async function refreshRoster() {
    try {
      setRoster(await apiFetch<RosterEntry[]>('/api/roster'));
    } catch (error: unknown) {
      setError({ title: "Couldn't reach the server", description: errorMessage(error), retry: refreshRoster });
    }
  }, []);

  useEffect(() => {
    // refreshContacts/refreshRoster catch their own errors, so this always
    // resolves — an initial fetch failure still counts as "settled" and
    // unblocks the list's animations rather than leaving them off forever.
    Promise.all([refreshContacts(), refreshRoster()]).then(() => setInitialLoadComplete(true));

    // Server push (src/web/control-server.ts's GET /api/events) so a change
    // made from another tab, or a live incoming message, shows up without
    // waiting on a poll — EventSource reconnects on its own on drop.
    const events = new EventSource('/api/events');
    events.onmessage = (event) => {
      if (event.data === 'contacts') refreshContacts();
      else if (event.data === 'roster') refreshRoster();
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
        await refreshRoster();
        return result.message ?? '';
      } catch (error: unknown) {
        setError({ title: 'Command failed', description: errorMessage(error), retry: async () => { await runCommand(contactId, action); } });
        return undefined;
      }
    },
    [refreshRoster],
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

  // Resolves true on success or rejects with a message, rather than
  // swallowing the failure into just the shared banner (like
  // setMonitored/runCommand/setEscalation above) — ContactDetailPanel's
  // explicit Save button needs the failure itself to drive its own
  // dirty/saving/saved/failed state and show an actionable, field-local
  // error instead of a panel-wide banner unrelated fields also see.
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
    initialLoadComplete,
  };
}
