import { useEffect, useMemo, useState } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { Input } from '@/components/ui/input';
import { matchesQuery } from '@/lib/contact';
import { fadeAndSlide } from '@/lib/listReorderAnimation';
import { ContactRow } from './ContactRow';
import type { Contact, RosterEntry } from '@/lib/types';

interface ContactListProps {
  contacts: Contact[];
  roster: RosterEntry[];
  selectedId: string | null;
  onSelect: (contactId: string) => void;
  onToggle: (contactId: string, monitored: boolean) => Promise<void>;
  onViewHistory: (contactId: string) => void;
  initialLoadComplete: boolean;
}

// Most-recently-active first, then name as a stable tiebreaker. Moderated
// contacts are split into their own section below rather than sorted to the
// top of one flat list.
function sortedFiltered(contacts: Contact[], query: string): Contact[] {
  return contacts
    .filter((contact) => matchesQuery(contact, query))
    .slice()
    .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0) || a.name.localeCompare(b.name));
}

export function ContactList({ contacts, roster, selectedId, onSelect, onToggle, onViewHistory, initialLoadComplete }: ContactListProps) {
  const [query, setQuery] = useState('');
  const monitoredIds = useMemo(() => new Set(roster.map((entry) => entry.id)), [roster]);
  const rosterById = useMemo(() => new Map(roster.map((entry) => [entry.id, entry])), [roster]);
  const filtered = useMemo(() => sortedFiltered(contacts, query.trim().toLowerCase()), [contacts, query]);
  const moderated = useMemo(() => filtered.filter((contact) => monitoredIds.has(contact.id)), [filtered, monitoredIds]);
  const others = useMemo(() => filtered.filter((contact) => !monitoredIds.has(contact.id)), [filtered, monitoredIds]);
  const [listRef, setAnimationsEnabled] = useAutoAnimate(fadeAndSlide);

  // The list mounts empty and contacts/roster arrive later over the network
  // (useControlData's initial fetch), so auto-animate — already watching the
  // container by the time that data lands — would otherwise play its
  // add/reorder animation for the whole list on every page load. Animations
  // stay off until that first fetch settles, then turn on (after a frame, so
  // the settled list paints in place first) for genuine later changes.
  useEffect(() => {
    if (!initialLoadComplete) {
      setAnimationsEnabled(false);
      return;
    }
    const frame = requestAnimationFrame(() => setAnimationsEnabled(true));
    return () => cancelAnimationFrame(frame);
  }, [initialLoadComplete, setAnimationsEnabled]);

  return (
    <div className="flex h-full flex-col">
      <Input
        type="search"
        placeholder="Search by name or number…"
        aria-label="Search by name or number"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="h-10 flex-none px-4"
      />
      <ul ref={listRef} className="@container mt-4 flex-1 overflow-y-auto pb-8" aria-label="Contacts">
        {filtered.length === 0 && <li className="py-6 text-center text-muted-foreground">No contacts match your search.</li>}
        {moderated.length > 0 && <SectionHeading key="heading-moderated">Moderated</SectionHeading>}
        {moderated.map((contact) => (
          <ContactRow
            key={contact.id}
            contact={contact}
            monitored={true}
            selected={contact.id === selectedId}
            onSelect={onSelect}
            entry={rosterById.get(contact.id)}
            onToggle={onToggle}
            onViewHistory={onViewHistory}
          />
        ))}
        {moderated.length > 0 && others.length > 0 && <li key="divider" role="separator" className="mx-2 my-2 border-t" />}
        {others.length > 0 && <SectionHeading key="heading-others">Other contacts</SectionHeading>}
        {others.map((contact) => (
          <ContactRow
            key={contact.id}
            contact={contact}
            monitored={false}
            selected={contact.id === selectedId}
            onSelect={onSelect}
            entry={rosterById.get(contact.id)}
            onToggle={onToggle}
            onViewHistory={onViewHistory}
          />
        ))}
      </ul>
    </div>
  );
}

function SectionHeading({ children }: { children: string }) {
  return (
    <li className="px-2 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground first:pt-0">
      <span role="heading" aria-level={2}>
        {children}
      </span>
    </li>
  );
}
