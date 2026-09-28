import type { Meta, StoryObj } from '@storybook/react-vite';
import { FIXTURE_STATS } from '@/lib/fixtures';
import { withMockApi } from '../../.storybook/withMockApi';
import { OverviewStats } from './OverviewStats';

const meta = {
  title: 'Components/OverviewStats',
  component: OverviewStats,
  decorators: [
    (Story) => (
      <div className="max-w-lg">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OverviewStats>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  decorators: [withMockApi([{ match: '/api/stats', body: FIXTURE_STATS }])],
};

export const Loading: Story = {
  decorators: [withMockApi([{ match: '/api/stats', body: FIXTURE_STATS, delayMs: 60_000 }])],
};

export const Failed: Story = {
  decorators: [withMockApi([{ match: '/api/stats', status: 500, body: { error: 'Internal error' } }])],
};
