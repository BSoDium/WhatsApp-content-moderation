import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { matchesQuery } from '@/lib/contact';
import { ContactRow } from './ContactRow';

function sortedFiltered(contacts, query) {
  return contacts
    .filter((contact) => matchesQuery(contact, query))
    .slice()
    .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0) || a.name.localeCompare(b.name));
}

export function ContactList({ contacts, roster, selectedId, onSelect, onToggle }) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => sortedFiltered(contacts, query.trim().toLowerCase()), [contacts, query]);

  return (
    <div className="flex h-full flex-col">
      <Input
        type="search"
        placeholder="Search by name or number…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="h-10 flex-none rounded-full px-4"
      />
      <ul className="mt-4 flex-1 overflow-y-auto" aria-label="All contacts">
        {filtered.length === 0 && <li className="py-6 text-center text-muted-foreground">No contacts match your search.</li>}
        {filtered.map((contact) => (
          <ContactRow
            key={contact.id}
            contact={contact}
            monitored={roster.some((entry) => entry.id === contact.id)}
            selected={contact.id === selectedId}
            onSelect={onSelect}
            onToggle={onToggle}
          />
        ))}
      </ul>
    </div>
  );
}
