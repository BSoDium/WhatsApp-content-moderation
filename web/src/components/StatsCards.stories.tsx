import type { Meta, StoryObj } from '@storybook/react-vite';
import { FIXTURE_STATS, FIXTURE_STATS_EMPTY } from '@/lib/fixtures';
import { StatsCards } from './StatsCards';

const meta = {
  title: 'Components/StatsCards',
  component: StatsCards,
  decorators: [
    (Story) => (
      <div className="max-w-lg">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof StatsCards>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithData: Story = {
  args: { stats: FIXTURE_STATS },
};

export const NoErrors: Story = {
  args: { stats: { ...FIXTURE_STATS, totalClassifierErrors: 0 } },
};

export const Empty: Story = {
  args: { stats: FIXTURE_STATS_EMPTY },
};

export const Loading: Story = {
  args: { stats: null },
};
