import { fn } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { FIXTURE_CONTACTS, FIXTURE_ROSTER } from '@/lib/fixtures';
import { ContactRow } from './ContactRow';

const meta = {
  title: 'Components/ContactRow',
  component: ContactRow,
  decorators: [
    (Story) => (
      <ul className="max-w-sm">
        <Story />
      </ul>
    ),
  ],
  args: {
    onSelect: fn(),
    onToggle: fn(async () => {}),
    onViewHistory: fn(),
  },
} satisfies Meta<typeof ContactRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unmoderated: Story = {
  args: {
    contact: FIXTURE_CONTACTS[0],
    monitored: false,
    entry: undefined,
    selected: false,
  },
};

export const Moderated: Story = {
  args: {
    contact: FIXTURE_CONTACTS[0],
    monitored: true,
    entry: FIXTURE_ROSTER[0],
    selected: false,
  },
};

export const Selected: Story = {
  args: {
    contact: FIXTURE_CONTACTS[0],
    monitored: true,
    entry: FIXTURE_ROSTER[0],
    selected: true,
  },
};

export const SelfBlocked: Story = {
  args: {
    contact: FIXTURE_CONTACTS.find((contact) => contact.isSelf)!,
    monitored: false,
    entry: undefined,
    selected: false,
  },
};

export const StrikesAndBlocked: Story = {
  args: {
    contact: FIXTURE_CONTACTS[0],
    monitored: true,
    entry: { ...FIXTURE_ROSTER[0], strikeCount: 12, block: { unblockAt: Date.now() + 60 * 60 * 1000 } },
    selected: false,
  },
};
