import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { Input } from '@/components/ui/input';
import { matchesQuery } from '@/lib/contact';
import { clamp01, useScrollLinkedStyle } from '@/lib/useScrollLinkedStyle';
import { fadeAndSlide } from '@/lib/listReorderAnimation';
import { ContactRow, ContactRowSkeleton } from './ContactRow';
import type { Contact, RosterEntry } from '@/lib/types';

interface ContactListProps {
  contacts: Contact[];
  roster: RosterEntry[];
  selectedId: string | null;
  onSelect: (contactId: string) => void;
  onToggle: (contactId: string, monitored: boolean) => Promise<void>;
  onViewHistory: (contactId: string) => void;
  initialLoadComplete: boolean;
  stickyTop?: ReactNode;
  isDesktop: boolean;
}

function sortedFiltered(contacts: Contact[], query: string): Contact[] {
  return contacts
    .filter((contact) => matchesQuery(contact, query))
    .slice()
    .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0) || a.name.localeCompare(b.name));
}

const SKELETON_ROW_COUNT = 8;
const FADE_RANGE_PX = 32;

export function ContactList({ contacts, roster, selectedId, onSelect, onToggle, onViewHistory, initialLoadComplete, stickyTop, isDesktop }: ContactListProps) {
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const listScrollRef = useRef<HTMLUListElement | null>(null);
  const monitoredIds = useMemo(() => new Set(roster.map((entry) => entry.id)), [roster]);
  const rosterById = useMemo(() => new Map(roster.map((entry) => [entry.id, entry])), [roster]);
  const filtered = useMemo(() => sortedFiltered(contacts, query.trim().toLowerCase()), [contacts, query]);
  const moderated = useMemo(() => filtered.filter((contact) => monitoredIds.has(contact.id)), [filtered, monitoredIds]);
  const others = useMemo(() => filtered.filter((contact) => !monitoredIds.has(contact.id)), [filtered, monitoredIds]);
  const [listRef, setAnimationsEnabled] = useAutoAnimate(fadeAndSlide);
  const setListRef = useCallback(
    (element: HTMLUListElement | null) => {
      listScrollRef.current = element;
      listRef(element);
    },
    [listRef],
  );

  // On desktop the list scrolls inside a fixed pane; on mobile the whole pane scrolls and App drives `--fade` from `--collapse` instead.
  const applyFade = useCallback((scroller: HTMLElement) => {
    rootRef.current?.style.setProperty('--fade', String(clamp01(scroller.scrollTop / FADE_RANGE_PX)));
  }, []);
  useScrollLinkedStyle(listScrollRef, isDesktop, applyFade);

  // Animations stay off until the first fetch settles, or auto-animate would play add/reorder for the whole list on every load.
  useEffect(() => {
    if (!initialLoadComplete) {
      setAnimationsEnabled(false);
      return;
    }
    const frame = requestAnimationFrame(() => setAnimationsEnabled(true));
    return () => cancelAnimationFrame(frame);
  }, [initialLoadComplete, setAnimationsEnabled]);

  return (
    <div ref={rootRef} className="flex flex-col lg:h-full">
      <div className="relative z-20 flex-none bg-background pt-2 pb-4 max-lg:sticky max-lg:top-0 lg:pt-0 lg:pb-0">
        {stickyTop && <div className="pb-4">{stickyTop}</div>}
        <Input
          type="search"
          placeholder="Search by name or number…"
          aria-label="Search by name or number"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-10 flex-none px-4"
        />
        <div
          aria-hidden="true"
          style={{ opacity: 'var(--fade, 0)' }}
          className="pointer-events-none absolute inset-x-0 top-full h-8 bg-linear-to-b from-background to-transparent max-lg:[--fade:var(--collapse,0)] lg:mt-4"
        />
      </div>
      <div className="relative min-h-0 flex-1 lg:mt-4">
        <ul
          ref={setListRef}
          className="@container pb-8 lg:h-full lg:overflow-y-auto"
          aria-label="Contacts"
          aria-busy={!initialLoadComplete}
        >
          {!initialLoadComplete && Array.from({ length: SKELETON_ROW_COUNT }, (_, i) => <ContactRowSkeleton key={`skeleton-${i}`} />)}
          {initialLoadComplete && filtered.length === 0 && (
            <li className="py-6 text-center text-muted-foreground">{contacts.length === 0 ? 'No contacts to show.' : 'No contacts match your search.'}</li>
          )}
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
