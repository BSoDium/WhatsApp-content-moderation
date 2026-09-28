import { fn } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { withMockApi, type MockRoute } from '../../.storybook/withMockApi';
import { PolicyEditor } from './PolicyEditor';

const FIXTURE_POLICY_TEXT = [
  'Flag anything that:',
  '- Is spam, a scam, or an unsolicited sales pitch',
  '- Is harassing, threatening, or abusive',
  '- Repeats the same message more than 3 times in a row',
  '',
  'Do not flag normal conversation, even if blunt or emotional.',
].join('\n');

function policyRoutes(initial = FIXTURE_POLICY_TEXT): MockRoute[] {
  let text = initial;
  return [
    { match: '/api/policy', bodyFn: () => ({ text }) },
    {
      method: 'POST',
      match: '/api/policy',
      bodyFn: (_path, init) => {
        ({ text } = JSON.parse(typeof init?.body === 'string' ? init.body : '{}'));
        return { text };
      },
    },
  ];
}

const meta = {
  title: 'Components/PolicyEditor',
  component: PolicyEditor,
  args: {
    open: true,
    onOpenChange: fn(),
  },
} satisfies Meta<typeof PolicyEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  decorators: [withMockApi(policyRoutes())],
};

export const Empty: Story = {
  decorators: [withMockApi(policyRoutes(''))],
};

export const LoadFailed: Story = {
  decorators: [withMockApi([{ match: '/api/policy', status: 500, body: { error: 'Policy store is locked' } }])],
};
