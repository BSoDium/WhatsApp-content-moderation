import type { Meta, StoryObj } from '@storybook/react-vite';
import { MissingModelHint } from './MissingModelHint';

const meta = {
  title: 'Components/MissingModelHint',
  component: MissingModelHint,
  decorators: [
    (Story) => (
      <div className="max-w-md text-xs text-destructive">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MissingModelHint>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { model: 'gemma2:9b' },
};

export const LongModelName: Story = {
  args: { model: 'hf.co/bartowski/Qwen2.5-7B-Instruct-GGUF:Q4_K_M' },
};
