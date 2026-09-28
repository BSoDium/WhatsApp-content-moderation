import type { Meta, StoryObj } from '@storybook/react-vite';
import { FIXTURE_AUDIT_LOG, FIXTURE_CONTACTS, FIXTURE_ROSTER, FIXTURE_SETTINGS, FIXTURE_STATS } from '@/lib/fixtures';
import type { RosterEntry } from '@/lib/types';
import { withMockApi, type MockRoute } from '../.storybook/withMockApi';
import App from './App';

// Backs every endpoint the app calls on load or through user action, with
// enough statefulness (roster add/remove, settings/policy saves) that
// clicking around this story behaves like the real control panel instead of
// a static screenshot.
function controlDataRoutes(initialRoster: RosterEntry[]): MockRoute[] {
  let roster = initialRoster;
  let settings = FIXTURE_SETTINGS;
  let policyText = 'Flag spam, scams, and harassment. Leave normal conversation alone.';

  return [
    { match: '/api/contacts', body: FIXTURE_CONTACTS },
    { match: '/api/roster', bodyFn: () => roster },
    {
      method: 'POST',
      match: '/api/roster',
      bodyFn: (_path, init) => {
        const { contactId } = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
        const contact = FIXTURE_CONTACTS.find((candidate) => candidate.id === contactId);
        if (contact && !roster.some((entry) => entry.id === contactId)) {
          roster = [
            ...roster,
            {
              id: contact.id,
              name: contact.name,
              escalationEnabled: true,
              context: null,
              paused: false,
              strikeCount: 0,
              block: null,
              callNuisance: { unansweredCount: 0, strikeCount: 0, threshold: 2, thresholdOverride: null },
            },
          ];
        }
        return { ok: true };
      },
    },
    {
      method: 'DELETE',
      match: /^\/api\/roster\/[^/]+$/,
      bodyFn: (path) => {
        const id = decodeURIComponent(path.slice('/api/roster/'.length));
        roster = roster.filter((entry) => entry.id !== id);
        return { ok: true };
      },
    },
    { match: '/api/meta', body: { authRequired: true } },
    { match: '/api/stats', body: FIXTURE_STATS },
    { match: '/api/settings', bodyFn: () => settings },
    {
      method: 'POST',
      match: /^\/api\/settings\//,
      bodyFn: (path, init) => {
        const key = decodeURIComponent(path.slice('/api/settings/'.length));
        const { value } = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
        settings = settings.map((setting) => (setting.key === key ? { ...setting, value } : setting));
        return { ok: true };
      },
    },
    { match: '/api/policy', bodyFn: () => ({ text: policyText }) },
    {
      method: 'POST',
      match: '/api/policy',
      bodyFn: (_path, init) => {
        ({ text: policyText } = JSON.parse(typeof init?.body === 'string' ? init.body : '{}'));
        return { text: policyText };
      },
    },
    { match: /^\/api\/audit-log/, body: { entries: FIXTURE_AUDIT_LOG, nextBefore: null } },
  ];
}

const meta = {
  title: 'Pages/App',
  component: App,
} satisfies Meta<typeof App>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  decorators: [withMockApi(controlDataRoutes(FIXTURE_ROSTER))],
};

export const NoContactsModerated: Story = {
  decorators: [withMockApi(controlDataRoutes([]))],
};

// authRequired: false surfaces OpenAccessBanner (App.tsx) — the app is
// reachable without Tailscale identity, which is worth calling out.
export const OpenAccess: Story = {
  decorators: [
    withMockApi(controlDataRoutes(FIXTURE_ROSTER).map((route) => (route.match === '/api/meta' ? { ...route, body: { authRequired: false } } : route))),
  ],
};
