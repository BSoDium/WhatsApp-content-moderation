import type { Meta, StoryObj } from '@storybook/react-vite';
import { FIXTURE_USER } from '@/lib/fixtures';
import { SignedInUser } from './SignedInUser';

const PICTURE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#5b3a9e"/><circle cx="20" cy="16" r="7" fill="#fff"/><path d="M6 40a14 14 0 0 1 28 0z" fill="#fff"/></svg>')}`;

const meta = {
  title: 'Components/SignedInUser',
  component: SignedInUser,
  decorators: [
    (Story) => (
      <div className="@container w-72 lg:w-72">
        <Story />
      </div>
    ),
  ],
  parameters: { viewport: { defaultViewport: 'desktop' } },
  args: { user: FIXTURE_USER },
} satisfies Meta<typeof SignedInUser>;

export default meta;
type Story = StoryObj<typeof meta>;

export const InitialsFallback: Story = {};

export const WithPicture: Story = {
  args: { user: { ...FIXTURE_USER, pictureUrl: PICTURE } },
};

export const NoTailnet: Story = {
  args: { user: { ...FIXTURE_USER, tailnet: null } },
};

export const NameOnly: Story = {
  args: { user: { ...FIXTURE_USER, name: FIXTURE_USER.login, tailnet: null } },
};
