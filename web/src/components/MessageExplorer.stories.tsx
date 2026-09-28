import { fn } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { FIXTURE_AUDIT_LOG, FIXTURE_CONTACTS } from '@/lib/fixtures';
import { MessageExplorer } from './MessageExplorer';

const meta = {
  title: 'Components/MessageExplorer',
  component: MessageExplorer,
  args: {
    contacts: FIXTURE_CONTACTS,
    contactId: '',
    onContactIdChange: fn(),
    action: '',
    onActionChange: fn(),
    searchInput: '',
    onSearchInputChange: fn(),
    onLoadMore: fn(),
  },
} satisfies Meta<typeof MessageExplorer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    entries: FIXTURE_AUDIT_LOG,
    loading: false,
    loadingMore: false,
    hasMore: true,
  },
};

export const NoResults: Story = {
  args: {
    entries: [],
    loading: false,
    loadingMore: false,
    hasMore: false,
  },
};

export const Loading: Story = {
  args: {
    entries: [],
    loading: true,
    loadingMore: false,
    hasMore: false,
  },
};

export const LoadingMore: Story = {
  args: {
    entries: FIXTURE_AUDIT_LOG,
    loading: false,
    loadingMore: true,
    hasMore: true,
  },
};
