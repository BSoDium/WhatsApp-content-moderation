import { fn } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { FIXTURE_AUDIT_LOG, FIXTURE_CONTACTS, FIXTURE_STATS } from '@/lib/fixtures';
import { withMockApi, type MockRoute } from '../../.storybook/withMockApi';
import { ActivityPanel } from './ActivityPanel';

function activityRoutes(): MockRoute[] {
  return [
    { match: '/api/stats', body: FIXTURE_STATS },
    { match: /^\/api\/audit-log/, body: { entries: FIXTURE_AUDIT_LOG, nextBefore: null } },
  ];
}

const meta = {
  title: 'Components/ActivityPanel',
  component: ActivityPanel,
  args: {
    open: true,
    onOpenChange: fn(),
    initialContactId: null,
    contacts: FIXTURE_CONTACTS,
  },
  decorators: [withMockApi(activityRoutes())],
} satisfies Meta<typeof ActivityPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  decorators: [withMockApi([{ match: '/api/stats', body: FIXTURE_STATS }, { match: /^\/api\/audit-log/, body: { entries: [], nextBefore: null } }])],
};

export const LoadFailed: Story = {
  decorators: [withMockApi([{ match: '/api/stats', status: 500, body: { error: 'Internal error' } }, { match: /^\/api\/audit-log/, status: 500, body: { error: 'Internal error' } }])],
};
