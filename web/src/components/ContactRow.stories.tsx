import { useState } from 'react';
import { fn } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { FIXTURE_CONTACTS, FIXTURE_ROSTER } from '@/lib/fixtures';
import { DEFAULT_STRIKE_LIMITS } from '@/lib/strikeLimits';
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
    strikeLimits: DEFAULT_STRIKE_LIMITS,
    onSelect: fn(),
    onToggle: fn(async () => {}),
    onViewHistory: fn(),
    onUnblock: fn(async () => {}),
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
    entry: { ...FIXTURE_ROSTER[0], strikeCount: 3, callNuisance: { ...FIXTURE_ROSTER[0].callNuisance, strikeCount: 1 }, block: { unblockAt: Date.now() + 60 * 60 * 1000 } },
    selected: false,
  },
};

function UnblockDemo(args: React.ComponentProps<typeof ContactRow>) {
  const [blocked, setBlocked] = useState(true);
  return (
    <div className="flex flex-col gap-3">
      <ContactRow
        {...args}
        entry={{ ...FIXTURE_ROSTER[0], block: blocked ? { unblockAt: Date.now() + 60 * 60 * 1000 } : null }}
        onUnblock={async () => setBlocked(false)}
      />
      <button type="button" className="self-start text-sm underline" onClick={() => setBlocked(true)}>
        Block again
      </button>
    </div>
  );
}

export const UnblockFromStatus: Story = {
  args: {
    contact: FIXTURE_CONTACTS[0],
    monitored: true,
    entry: { ...FIXTURE_ROSTER[0], block: { unblockAt: Date.now() + 60 * 60 * 1000 } },
    selected: false,
  },
  render: (args) => <UnblockDemo {...args} />,
};
