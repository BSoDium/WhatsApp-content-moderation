import { fn } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { FIXTURE_CONTACTS, FIXTURE_ROSTER } from '@/lib/fixtures';
import { ContactList } from './ContactList';

const meta = {
  title: 'Components/ContactList',
  component: ContactList,
  decorators: [
    (Story) => (
      <div className="h-[600px] max-w-md border border-border">
        <Story />
      </div>
    ),
  ],
  args: {
    initialLoadComplete: true,
    selectedId: null,
    onSelect: fn(),
    onToggle: fn(async () => {}),
    onViewHistory: fn(),
  },
} satisfies Meta<typeof ContactList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MixedModeration: Story = {
  args: {
    contacts: FIXTURE_CONTACTS,
    roster: FIXTURE_ROSTER,
  },
};

export const NoneModerated: Story = {
  args: {
    contacts: FIXTURE_CONTACTS,
    roster: [],
  },
};

export const AllModerated: Story = {
  args: {
    contacts: FIXTURE_CONTACTS,
    roster: FIXTURE_CONTACTS.map((contact) => ({
      id: contact.id,
      name: contact.name,
      escalationEnabled: true,
      context: null,
      paused: false,
      strikeCount: 0,
      block: null,
      callNuisance: { unansweredCount: 0, strikeCount: 0, threshold: 2, thresholdOverride: null },
    })),
  },
};

export const Empty: Story = {
  args: {
    contacts: [],
    roster: [],
  },
};
