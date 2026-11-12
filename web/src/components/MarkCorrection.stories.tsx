import { expect, fn, userEvent, within } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { MarkCorrection } from './MarkCorrection';

const meta = {
  title: 'Components/MarkCorrection',
  component: MarkCorrection,
  args: { kind: 'false_positive', onSubmit: fn(async () => {}) },
  decorators: [(Story) => <div className="flex h-72 justify-end p-8"><Story /></div>],
} satisfies Meta<typeof MarkCorrection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FalsePositive: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /mark as false positive/i }));
  },
};

export const FalseNegative: Story = {
  args: { kind: 'false_negative' },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /mark as false negative/i }));
  },
};

export const SubmitFails: Story = {
  args: { onSubmit: fn(async () => { throw new Error('this message is already marked'); }) },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /mark as false positive/i }));
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole('button', { name: 'Mark' }));
    await expect(await body.findByText('this message is already marked')).toBeInTheDocument();
  },
};
