import type { Meta, StoryObj } from '@storybook/react-vite';
import { TailscaleLogo } from './TailscaleLogo';

const meta = {
  title: 'Components/TailscaleLogo',
  component: TailscaleLogo,
  args: { className: 'size-12' },
} satisfies Meta<typeof TailscaleLogo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
