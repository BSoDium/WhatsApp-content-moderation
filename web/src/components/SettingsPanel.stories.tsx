import { fn } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { FIXTURE_SETTINGS } from '@/lib/fixtures';
import { withMockApi, type MockRoute } from '../../.storybook/withMockApi';
import { SettingsPanel } from './SettingsPanel';

// POST /api/settings/:key mutates this so a save is reflected by the
// following GET /api/settings — SettingsPanel refetches the whole list
// after every save rather than trusting its own optimistic write.
function settingsRoutes(initial = FIXTURE_SETTINGS): MockRoute[] {
  let settings = initial;
  return [
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
  ];
}

const meta = {
  title: 'Components/SettingsPanel',
  component: SettingsPanel,
  args: {
    open: true,
    onOpenChange: fn(),
  },
} satisfies Meta<typeof SettingsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  decorators: [withMockApi(settingsRoutes())],
};

export const LoadFailed: Story = {
  decorators: [withMockApi([{ match: '/api/settings', status: 500, body: { error: 'Settings store is locked' } }])],
};
