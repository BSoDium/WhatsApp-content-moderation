import type { Meta, StoryObj } from '@storybook/react-vite';
import { MessageSquare, Phone } from 'lucide-react';
import { StrikeCounter } from './StrikeCounter';

const meta = {
  title: 'Components/StrikeCounter',
  component: StrikeCounter,
  args: { icon: MessageSquare, label: 'Message strikes', count: 0, limit: 3 },
} satisfies Meta<typeof StrikeCounter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const None: Story = {};

export const SomeStrikes: Story = { args: { count: 1 } };

export const AtLimit: Story = { args: { icon: Phone, label: 'Call strikes', count: 3 } };
