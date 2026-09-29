import type { Meta, StoryObj } from '@storybook/react-vite';
import { DirectConnection } from './DirectConnection';

const meta = {
  title: 'Components/DirectConnection',
  component: DirectConnection,
  decorators: [
    (Story) => (
      <div className="@container w-72">
        <Story />
      </div>
    ),
  ],
  parameters: { viewport: { defaultViewport: 'desktop' } },
} satisfies Meta<typeof DirectConnection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
