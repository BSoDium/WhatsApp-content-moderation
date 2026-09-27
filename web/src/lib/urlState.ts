export interface UrlState {
  contactId: string | null;
  activityOpen: boolean;
  activityContactId: string | null;
}

const CONTACT_PARAM = 'contact';
const ACTIVITY_PARAM = 'activity';
// The activity panel with no contact filter has nothing to put in
// ACTIVITY_PARAM's value beyond "it's open" — this is that sentinel.
const ACTIVITY_OPEN_SENTINEL = '1';

/**
 * Reads the selected contact / activity panel state out of the current
 * URL's query string, for App.tsx to seed its state from on first render —
 * so a page refresh reopens the same contact or activity view instead of
 * landing back on the bare contact list.
 */
export function readUrlState(): UrlState {
  const params = new URLSearchParams(window.location.search);
  const activity = params.get(ACTIVITY_PARAM);
  return {
    contactId: params.get(CONTACT_PARAM),
    activityOpen: activity !== null,
    activityContactId: activity && activity !== ACTIVITY_OPEN_SENTINEL ? activity : null,
  };
}

/**
 * Mirrors App.tsx's current selection/panel state into the URL via
 * history.replaceState — deliberately not pushState, so opening a contact
 * or the activity panel doesn't pile up browser-back entries for every
 * click; a refresh is what this is for, not back/forward navigation.
 */
export function writeUrlState({ contactId, activityOpen, activityContactId }: UrlState): void {
  const params = new URLSearchParams();
  if (contactId) params.set(CONTACT_PARAM, contactId);
  if (activityOpen) params.set(ACTIVITY_PARAM, activityContactId ?? ACTIVITY_OPEN_SENTINEL);
  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ''}`;
  window.history.replaceState(null, '', url);
}
