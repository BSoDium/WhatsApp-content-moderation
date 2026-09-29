import type { Meta, StoryObj } from '@storybook/react-vite';
import { DirectAccessWarning } from './DirectAccessWarning';

const meta = {
  title: 'Components/DirectAccessWarning',
  component: DirectAccessWarning,
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DirectAccessWarning>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
