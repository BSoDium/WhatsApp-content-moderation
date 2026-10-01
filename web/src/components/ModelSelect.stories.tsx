import { fn } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ModelSelect } from './ModelSelect';

const MODELS = [
  { name: 'llama3.2:3b', sizeBytes: 2019393189 },
  { name: 'qwen2.5:7b', sizeBytes: 4683087332 },
];

const meta = {
  title: 'Components/ModelSelect',
  component: ModelSelect,
  args: { models: MODELS, inheritsClassifier: false, onChange: fn() },
} satisfies Meta<typeof ModelSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Installed: Story = {
  args: { value: 'llama3.2:3b' },
};

export const InheritsClassifier: Story = {
  args: { value: '', inheritsClassifier: true },
};

export const NotInstalled: Story = {
  args: { value: 'gemma2:9b' },
};
