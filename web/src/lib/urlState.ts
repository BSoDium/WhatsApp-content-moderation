export type PanelName = 'activity' | 'policy' | 'settings';

const PANEL_NAMES: readonly PanelName[] = ['activity', 'policy', 'settings'];

function isPanelName(value: string): value is PanelName {
  return (PANEL_NAMES as readonly string[]).includes(value);
}

export interface UrlState {
  contactId: string | null;
  openPanel: PanelName | null;
  // Only meaningful when openPanel === 'activity' — which contact its
  // audit-log filter is scoped to, independent of the separately-tracked
  // `contact` param (the detail panel can be open on one contact while
  // Activity is filtered to a different one, or to none).
  activityContactId: string | null;
}

export type HistoryMode = 'push' | 'replace';

const CONTACT_PARAM = 'contact';
const PANEL_PARAM = 'openPanel';
const ACTIVITY_CONTACT_PARAM = 'activityContact';

interface HistoryMarker {
  navIndex: number;
}

// What each entry of this page load's history stack showed, keyed by its `navIndex`. Lost on reload, which only costs the back-instead-of-push shortcut in `popUrlStateIfPrevious`.
const snapshots = new Map<number, UrlState>();

/**
 * Reads the selected contact / open global panel out of the current URL's
 * query string, for App.tsx to seed its state from on first render — so a
 * page refresh or a shared deep link reopens the same view instead of
 * landing back on the bare list. An unrecognized `openPanel` value (a
 * stale link, a typo, a param from an older version of this app) is
 * treated as absent rather than surfaced as an error.
 */
export function readUrlState(): UrlState {
  const params = new URLSearchParams(window.location.search);
  const panelRaw = params.get(PANEL_PARAM);
  const openPanel = panelRaw !== null && isPanelName(panelRaw) ? panelRaw : null;
  return {
    contactId: params.get(CONTACT_PARAM),
    openPanel,
    activityContactId: openPanel === 'activity' ? params.get(ACTIVITY_CONTACT_PARAM) : null,
  };
}

export function historyIndex(): number {
  const marker = window.history.state as Partial<HistoryMarker> | null;
  return marker?.navIndex ?? 0;
}

export function sameUrlState(a: UrlState, b: UrlState): boolean {
  return a.contactId === b.contactId && a.openPanel === b.openPanel && a.activityContactId === b.activityContactId;
}

// `activityContactId` only means something while the Activity panel is open, so it is dropped otherwise to keep states comparable.
export function toUrlState(contactId: string | null, openPanel: PanelName | null, activityContactId: string | null): UrlState {
  return { contactId, openPanel, activityContactId: openPanel === 'activity' ? activityContactId : null };
}

function buildUrl({ contactId, openPanel, activityContactId }: UrlState): string {
  const params = new URLSearchParams(window.location.search);
  params.delete(CONTACT_PARAM);
  params.delete(PANEL_PARAM);
  params.delete(ACTIVITY_CONTACT_PARAM);
  if (contactId) params.set(CONTACT_PARAM, contactId);
  if (openPanel) {
    params.set(PANEL_PARAM, openPanel);
    if (openPanel === 'activity' && activityContactId) params.set(ACTIVITY_CONTACT_PARAM, activityContactId);
  }
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
}

/**
 * Mirrors App.tsx's current selection/panel state into the URL, so the
 * browser's back button walks back through what was opened. `'push'` adds a
 * history entry; `'replace'` rewrites the current one, for the first sync
 * and for corrections (a stale contact id) that shouldn't become a back
 * stop. A state that already matches the URL — every popstate — writes
 * nothing. Rebuilds only the params this app owns (contact/openPanel/
 * activityContact); any other query params and the URL hash are carried
 * over untouched, and an invalid openPanel value left over from a stale
 * link is dropped on the first sync since it never round-trips through
 * UrlState.
 */
export function writeUrlState(state: UrlState, mode: HistoryMode = 'push'): void {
  const url = buildUrl(state);
  const index = historyIndex();
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  if (url === current) {
    snapshots.set(index, state);
    return;
  }
  if (mode === 'replace') {
    window.history.replaceState({ navIndex: index } satisfies HistoryMarker, '', url);
    snapshots.set(index, state);
    return;
  }
  for (const key of snapshots.keys()) if (key > index) snapshots.delete(key);
  window.history.pushState({ navIndex: index + 1 } satisfies HistoryMarker, '', url);
  snapshots.set(index + 1, state);
}

/**
 * Closing something through the UI should land where the user came from
 * rather than stack a "closed" entry that back would then reopen. Steps back
 * and returns true only when the previous entry is exactly `target`; returns
 * false (nothing done) otherwise, e.g. after a reload or a deep link, so the
 * caller falls back to updating state and pushing.
 */
export function popUrlStateIfPrevious(target: UrlState): boolean {
  const previous = snapshots.get(historyIndex() - 1);
  if (!previous || !sameUrlState(previous, target)) return false;
  window.history.back();
  return true;
}
