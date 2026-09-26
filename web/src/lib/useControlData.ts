import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './api';
import type { Contact, ControlError, OverrideCommand, RosterEntry } from './types';

const ROSTER_POLL_MS = 5000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Controlled Switch/inputs read straight from contacts/roster state, so a failed mutation never applies the optimistic change React already rendered.
export function useControlData() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<ControlError | null>(null);

  // Named function expressions, not bare arrows, so a retry closure can call the in-progress function by name.
  const refreshContacts = useCallback(async function refreshContacts() {
    try {
      setContacts(await apiFetch<Contact[]>('/api/contacts'));
    } catch (error: unknown) {
      setError({ title: 'Could not load contacts', description: errorMessage(error), retry: refreshContacts });
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
    refreshContacts();
    refreshRoster();
    const id = setInterval(() => {
      refreshContacts();
      refreshRoster();
    }, ROSTER_POLL_MS);
    return () => clearInterval(id);
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

  const dismissError = useCallback(() => setError(null), []);

  return { contacts, roster, selectedId, setSelectedId, error, dismissError, setMonitored, runCommand, setEscalation };
}
