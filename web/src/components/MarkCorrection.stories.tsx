import { expect, fn, userEvent, within } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { correctionOptions } from '@/lib/activity';
import { FIXTURE_AUDIT_LOG } from '@/lib/fixtures';
import { MarkCorrection } from './MarkCorrection';

const FLAGGED_ROW = FIXTURE_AUDIT_LOG.find((entry) => entry.action === 'delete+warn');
const PASSED_ROW = FIXTURE_AUDIT_LOG.find((entry) => entry.action === 'none' && entry.flagged === false);

const meta = {
  title: 'Components/MarkCorrection',
  component: MarkCorrection,
  args: { options: FLAGGED_ROW ? correctionOptions(FLAGGED_ROW) : [], onSubmit: fn(async () => {}) },
  decorators: [(Story) => <div className="flex h-96 justify-end p-8"><Story /></div>],
} satisfies Meta<typeof MarkCorrection>;

export default meta;
type Story = StoryObj<typeof meta>;

const open = async (canvasElement: HTMLElement) => userEvent.click(within(canvasElement).getByRole('button', { name: /label this message/i }));

export const FlaggedMessage: Story = {
  play: async ({ canvasElement }) => {
    await open(canvasElement);
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole('radio', { name: /^acceptable/i }));
  },
};

export const PassedMessage: Story = {
  args: { options: PASSED_ROW ? correctionOptions(PASSED_ROW) : [] },
  play: async ({ canvasElement }) => {
    await open(canvasElement);
  },
};

export const SubmitFails: Story = {
  args: { onSubmit: fn(async () => { throw new Error('this message is already marked'); }) },
  play: async ({ canvasElement }) => {
    await open(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole('radio', { name: /^not acceptable/i }));
    await userEvent.click(await body.findByRole('button', { name: 'Save label' }));
    await expect(await body.findByText('this message is already marked')).toBeInTheDocument();
  },
};
