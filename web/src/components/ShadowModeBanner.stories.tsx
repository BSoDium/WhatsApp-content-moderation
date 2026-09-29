import { fn } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ShadowModeBanner } from './ShadowModeBanner';

const meta = {
  title: 'Components/ShadowModeBanner',
  component: ShadowModeBanner,
  decorators: [
    (Story) => (
      <div className="max-w-lg">
        <Story />
      </div>
    ),
  ],
  args: {
    onOpenSettings: fn(),
  },
} satisfies Meta<typeof ShadowModeBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
