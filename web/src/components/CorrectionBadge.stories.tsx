import type { Meta, StoryObj } from '@storybook/react-vite';
import { CorrectionBadge } from './CorrectionBadge';

const meta = {
  title: 'Components/CorrectionBadge',
  component: CorrectionBadge,
} satisfies Meta<typeof CorrectionBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FalsePositive: Story = {
  args: { correction: { id: 1, kind: 'false_positive', note: 'Friendly banter between old friends', strikeReverted: true, createdAt: 0 } },
};

export const FalseNegative: Story = {
  args: { correction: { id: 2, kind: 'false_negative', note: null, strikeReverted: false, createdAt: 0 } },
};
