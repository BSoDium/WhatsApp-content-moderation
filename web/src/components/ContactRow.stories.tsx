import { fn } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { FIXTURE_CONTACTS } from '@/lib/fixtures';
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
  },
} satisfies Meta<typeof ContactRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unmoderated: Story = {
  args: {
    contact: FIXTURE_CONTACTS[0],
    monitored: false,
    selected: false,
  },
};

export const Moderated: Story = {
  args: {
    contact: FIXTURE_CONTACTS[0],
    monitored: true,
    selected: false,
  },
};

export const Selected: Story = {
  args: {
    contact: FIXTURE_CONTACTS[0],
    monitored: true,
    selected: true,
  },
};

export const SelfBlocked: Story = {
  args: {
    contact: FIXTURE_CONTACTS.find((contact) => contact.isSelf)!,
    monitored: false,
    selected: false,
  },
};
