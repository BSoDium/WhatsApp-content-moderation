import { fn } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { FIXTURE_CONTACTS, FIXTURE_ROSTER } from '@/lib/fixtures';
import { ContactDetailPanel } from './ContactDetailPanel';

const meta = {
  title: 'Components/ContactDetailPanel',
  component: ContactDetailPanel,
  decorators: [
    (Story) => (
      <div className="h-[700px] max-w-lg border border-border">
        <Story />
      </div>
    ),
  ],
  args: {
    onClose: fn(),
    onToggleMonitor: fn(async () => {}),
    onRunCommand: fn(async () => undefined),
    onSetEscalation: fn(async () => {}),
    onSetContext: fn(async () => true as const),
    onViewHistory: fn(),
  },
} satisfies Meta<typeof ContactDetailPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unmoderated: Story = {
  args: {
    contact: FIXTURE_CONTACTS[0],
    entry: undefined,
  },
};

export const Moderated: Story = {
  args: {
    contact: FIXTURE_CONTACTS[0],
    entry: FIXTURE_ROSTER[0],
  },
};

export const Blocked: Story = {
  args: {
    contact: FIXTURE_CONTACTS[1],
    entry: FIXTURE_ROSTER[1],
  },
};

export const Paused: Story = {
  args: {
    contact: FIXTURE_CONTACTS[0],
    entry: { ...FIXTURE_ROSTER[0], paused: true },
  },
};

export const SelfBlocked: Story = {
  args: {
    contact: FIXTURE_CONTACTS.find((contact) => contact.isSelf)!,
    entry: undefined,
  },
};

export const NoContactSelected: Story = {
  args: {
    contact: null,
    entry: undefined,
  },
};
