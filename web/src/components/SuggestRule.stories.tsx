import { expect, fn, userEvent, within } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { withMockApi } from '../../.storybook/withMockApi';
import { SuggestRule } from './SuggestRule';

const SUGGESTION = {
  currentRule: 'Flag insults.',
  candidate: 'Flag insults.\n- Flag messages that demand I call back or answer right now (e.g. "call me", "réponds-moi").',
  rationale: 'Adds the demands to answer that your unacceptable messages share.',
  backtest: {
    labelled: [],
    flips: [
      { auditLogId: 12, message: 'Can you call me when you get a minute?', wasFlagged: false, nowFlagged: true },
      { auditLogId: 9, message: 'merci pour hier, bonne soirée', wasFlagged: true, nowFlagged: false },
    ],
    summary: { labelled: 6, correctBefore: 3, correctNow: 6, failed: 0, checkedUnlabelled: 16 },
  },
};

const meta = {
  title: 'Components/SuggestRule',
  component: SuggestRule,
  args: { scope: 'global', onUse: fn() },
  decorators: [(Story) => <div className="max-w-xl p-6"><Story /></div>],
} satisfies Meta<typeof SuggestRule>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {
  decorators: [withMockApi([{ method: 'POST', match: '/api/rules/suggest', body: SUGGESTION }])],
};

export const Suggested: Story = {
  decorators: [withMockApi([{ method: 'POST', match: '/api/rules/suggest', body: SUGGESTION }])],
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /suggest rule from labels/i }));
    await expect(await within(canvasElement).findByRole('button', { name: 'Use as draft' })).toBeInTheDocument();
  },
};

export const NoLabels: Story = {
  decorators: [withMockApi([{ method: 'POST', match: '/api/rules/suggest', status: 422, body: { error: 'label some messages in the activity panel first' } }])],
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /suggest rule from labels/i }));
    await expect(await within(canvasElement).findByRole('alert')).toHaveTextContent('label some messages');
  },
};

export const ModelUnreachable: Story = {
  decorators: [withMockApi([{ method: 'POST', match: '/api/rules/suggest', status: 502, body: { error: 'connect ECONNREFUSED 127.0.0.1:11434' } }])],
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /suggest rule from labels/i }));
    await expect(await within(canvasElement).findByRole('alert')).toHaveTextContent('ECONNREFUSED');
  },
};
