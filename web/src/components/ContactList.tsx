import { useMemo, useState } from 'react';
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
}

// Moderated contacts first (so turning moderation on visibly pins a contact
// to the top), then most-recently-active, then name as a stable tiebreaker.
function sortedFiltered(contacts: Contact[], query: string, monitoredIds: Set<string>): Contact[] {
  return contacts
    .filter((contact) => matchesQuery(contact, query))
    .slice()
    .sort(
      (a, b) =>
        Number(monitoredIds.has(b.id)) - Number(monitoredIds.has(a.id)) ||
        (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0) ||
        a.name.localeCompare(b.name),
    );
}

export function ContactList({ contacts, roster, selectedId, onSelect, onToggle }: ContactListProps) {
  const [query, setQuery] = useState('');
  const monitoredIds = useMemo(() => new Set(roster.map((entry) => entry.id)), [roster]);
  const filtered = useMemo(() => sortedFiltered(contacts, query.trim().toLowerCase(), monitoredIds), [contacts, query, monitoredIds]);
  const [listRef] = useAutoAnimate(fadeAndSlide);

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
      <ul ref={listRef} className="mt-4 flex-1 overflow-y-auto pb-8" aria-label="All contacts">
        {filtered.length === 0 && <li className="py-6 text-center text-muted-foreground">No contacts match your search.</li>}
        {filtered.map((contact) => (
          <ContactRow
            key={contact.id}
            contact={contact}
            monitored={monitoredIds.has(contact.id)}
            selected={contact.id === selectedId}
            onSelect={onSelect}
            onToggle={onToggle}
          />
        ))}
      </ul>
    </div>
  );
}
