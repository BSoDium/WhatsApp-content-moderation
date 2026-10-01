import { fn } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { BlockStatus } from './BlockStatus';

const UNBLOCK_AT = Date.now() + 60 * 60 * 1000;

const meta = {
  title: 'Components/BlockStatus',
  component: BlockStatus,
  decorators: [
    (Story) => (
      <div className="@container flex w-96">
        <Story />
      </div>
    ),
  ],
  args: { blockedUntil: null, contactName: 'Alice Moreau', onUnblock: fn(async () => {}) },
} satisfies Meta<typeof BlockStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NotBlocked: Story = {};

export const Blocked: Story = { args: { blockedUntil: UNBLOCK_AT } };

export const Unblocking: Story = { args: { blockedUntil: UNBLOCK_AT, onUnblock: fn(() => new Promise<void>(() => {})) } };
