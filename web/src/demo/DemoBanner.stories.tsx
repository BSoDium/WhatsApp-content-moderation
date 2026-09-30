import type { Meta, StoryObj } from '@storybook/react-vite';
import { DemoBanner } from './DemoBanner';

const meta = {
  title: 'Demo/DemoBanner',
  component: DemoBanner,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="h-40">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DemoBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
