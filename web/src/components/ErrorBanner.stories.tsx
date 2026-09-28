import { fn } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ErrorBanner } from './ErrorBanner';

const meta = {
  title: 'Components/ErrorBanner',
  component: ErrorBanner,
  decorators: [
    (Story) => (
      <div className="max-w-lg">
        <Story />
      </div>
    ),
  ],
  args: {
    onDismiss: fn(),
  },
} satisfies Meta<typeof ErrorBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithRetry: Story = {
  args: {
    error: { title: "Couldn't reach the server", description: 'Request to /api/roster failed: fetch failed', retry: fn() },
  },
};

export const WithoutRetry: Story = {
  args: {
    error: { title: 'Could not save "Strike limit"', description: 'Strike limit must be at least 1' },
  },
};
