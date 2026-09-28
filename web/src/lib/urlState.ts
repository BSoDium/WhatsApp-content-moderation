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

const CONTACT_PARAM = 'contact';
const PANEL_PARAM = 'openPanel';
const ACTIVITY_CONTACT_PARAM = 'activityContact';

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

/**
 * Mirrors App.tsx's current selection/panel state into the URL via
 * history.replaceState — deliberately not pushState, so opening a contact
 * or a panel doesn't pile up browser-back entries for every click.
 * Rebuilds only the params this app owns (contact/openPanel/
 * activityContact); any other query params and the URL hash are carried
 * over untouched, and an invalid openPanel value left over from a stale
 * link is dropped on the very first sync since it never round-trips
 * through UrlState.
 */
export function writeUrlState({ contactId, openPanel, activityContactId }: UrlState): void {
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
  const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  window.history.replaceState(null, '', url);
}
