import type { Contact, RosterEntry } from './types';

// A small fixed palette, not a full HSL wheel, so colors stay legible against both light and dark surfaces without per-theme tuning.
const AVATAR_COLORS = ['#1d7874', '#c65102', '#5b3a9e', '#0f6e94', '#a8325e', '#2f7a3f', '#8a5a00', '#3f51b5'];

export function colorFor(contactId: string): string {
  let hash = 0;
  for (let i = 0; i < contactId.length; i++) hash = (hash * 31 + contactId.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function initialsFor(name: string): string {
  // Digits only, not name.slice(1, 3) — a short country code like "+1 555…" would otherwise slice into the space after it.
  if (name.startsWith('+')) return name.replace(/\D/g, '').slice(0, 2);
  const words = name.trim().split(/\s+/);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

const RELATIVE_TIME_FORMAT = new Intl.RelativeTimeFormat('en', { numeric: 'always' });
const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

export function relativeTime(ms: number | null): string {
  if (!ms) return 'No interactions yet';
  const diff = Date.now() - ms;
  for (const [unit, unitMs] of RELATIVE_UNITS) {
    const count = Math.floor(diff / unitMs);
    if (count >= 1) return `Last interaction ${RELATIVE_TIME_FORMAT.format(-count, unit)}`;
  }
  return 'Last interaction just now';
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

// A JID never contains the '+' a user naturally types, so numbers match on digits-only strings instead of substring.
export function matchesQuery(contact: Contact, query: string): boolean {
  if (!query) return true;
  if (contact.name.toLowerCase().includes(query)) return true;
  const digits = digitsOnly(query);
  return digits.length > 0 && contact.id.split('@')[0].includes(digits);
}

// Strikes and a block outlive the roster row, so a contact switched off after being blocked is only described by the contacts feed.
export function moderationState(contact: Contact, entry: RosterEntry | undefined): { strikeCount: number; block: { unblockAt: number } | null } {
  return {
    strikeCount: entry?.strikeCount ?? contact.strikeCount ?? 0,
    block: entry ? entry.block : (contact.block ?? null),
  };
}
