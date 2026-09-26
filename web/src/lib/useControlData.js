import { useCallback, useEffect, useState } from 'react';
import { apiFetch, getToken } from './api';

const ROSTER_POLL_MS = 5000;
const NO_TOKEN_ERROR = { title: 'No control token', description: 'Reload using the full link with ?token=... in the URL.' };

// Controlled Switch/inputs read straight from `contacts`/`roster` state, so
// a failed mutation just never applies the optimistic change React already
// rendered — no separate "revert the switch" step needed, unlike the old
// vanilla-DOM version this replaces.
export function useControlData() {
  const [contacts, setContacts] = useState([]);
  const [roster, setRoster] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState(() => (getToken() ? null : NO_TOKEN_ERROR));

  // Named function expressions (not bare arrows assigned to the outer
  // const) so a retry closure can call the in-progress function by name
  // without reading the outer binding before useCallback finishes
  // returning it.
  const refreshContacts = useCallback(async function refreshContacts() {
    try {
      setContacts(await apiFetch('/api/contacts'));
    } catch (err) {
      setError({ title: 'Could not load contacts', description: err.message, retry: refreshContacts });
    }
  }, []);

  const refreshRoster = useCallback(async function refreshRoster() {
    try {
      setRoster(await apiFetch('/api/roster'));
    } catch (err) {
      setError({ title: "Couldn't reach the server", description: err.message, retry: refreshRoster });
    }
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    refreshContacts();
    refreshRoster();
    const id = setInterval(() => {
      refreshContacts();
      refreshRoster();
    }, ROSTER_POLL_MS);
    return () => clearInterval(id);
  }, [refreshContacts, refreshRoster]);

  const setMonitored = useCallback(
    async function setMonitored(contactId, monitored) {
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
        await Promise.all([refreshRoster(), refreshContacts()]);
      } catch (err) {
        setError({ title: 'Could not update moderation', description: err.message, retry: () => setMonitored(contactId, monitored) });
      }
    },
    [refreshContacts, refreshRoster],
  );

  const runCommand = useCallback(
    async function runCommand(contactId, action) {
      try {
        const result = await apiFetch(`/api/roster/${encodeURIComponent(contactId)}/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        setError(null);
        await refreshRoster();
        return result.message ?? '';
      } catch (err) {
        setError({ title: 'Command failed', description: err.message, retry: () => runCommand(contactId, action) });
        return undefined;
      }
    },
    [refreshRoster],
  );

  const setEscalation = useCallback(
    async function setEscalation(contactId, enabled) {
      try {
        await apiFetch(`/api/roster/${encodeURIComponent(contactId)}/escalation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled }),
        });
        setError(null);
        await refreshRoster();
      } catch (err) {
        setError({ title: 'Could not update escalation', description: err.message, retry: () => setEscalation(contactId, enabled) });
      }
    },
    [refreshRoster],
  );

  return { contacts, roster, selectedId, setSelectedId, error, setMonitored, runCommand, setEscalation };
}
