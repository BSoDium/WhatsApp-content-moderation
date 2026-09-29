import { expect, userEvent, within } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { FIXTURE_STATUS, FIXTURE_USER } from '@/lib/fixtures';
import { withMockApi } from '../../.storybook/withMockApi';
import { DiagnosticsPopover } from './DiagnosticsPopover';

const meta = {
  title: 'Components/DiagnosticsPopover',
  component: DiagnosticsPopover,
  decorators: [
    (Story) => (
      <div className="@container h-80 w-72">
        <Story />
      </div>
    ),
  ],
  args: {
    user: FIXTURE_USER,
    lastRefreshedAt: Date.now() - 12_000,
    streamLive: true,
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /diagnostics/i }));
    await expect(await within(document.body).findByText('Version')).toBeInTheDocument();
  },
} satisfies Meta<typeof DiagnosticsPopover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Connected: Story = {
  decorators: [withMockApi([{ match: '/api/status', body: FIXTURE_STATUS }])],
};

export const LoggedOut: Story = {
  args: { streamLive: false },
  decorators: [
    withMockApi([{ match: '/api/status', body: { ...FIXTURE_STATUS, whatsapp: { status: 'logged-out', since: Date.now() - 60_000, statusCode: 401 } } }]),
  ],
};

export const DirectConnection: Story = {
  args: { user: null },
  decorators: [withMockApi([{ match: '/api/status', body: FIXTURE_STATUS }])],
};

export const ServerUnreachable: Story = {
  args: { streamLive: false },
  decorators: [withMockApi([{ match: '/api/status', status: 500, body: { error: 'boom' } }])],
};
