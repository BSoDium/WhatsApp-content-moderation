import type { Meta, StoryObj } from '@storybook/react-vite';
import { SelfModerationNotice } from './SelfModerationNotice';

const meta = {
  title: 'Components/SelfModerationNotice',
  component: SelfModerationNotice,
  decorators: [
    (Story) => (
      <div className="flex h-[500px] max-w-lg border border-border">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SelfModerationNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
