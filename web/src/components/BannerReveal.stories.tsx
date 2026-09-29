import { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '@/components/ui/button';
import { BannerReveal } from './BannerReveal';
import { ShadowModeBanner } from './ShadowModeBanner';

function TogglableBanner() {
  const [visible, setVisible] = useState(false);
  return (
    <div className="max-w-2xl p-4">
      <Button variant="outline" onClick={() => setVisible((prev) => !prev)}>
        {visible ? 'Hide banner' : 'Show banner'}
      </Button>
      <AnimatePresence initial={false}>
        {visible && (
          <BannerReveal key="banner">
            <ShadowModeBanner onOpenSettings={() => {}} />
          </BannerReveal>
        )}
      </AnimatePresence>
      <p className="mt-4 text-sm text-muted-foreground">Content below the banner, to show it being pushed down.</p>
    </div>
  );
}

const meta = {
  title: 'Components/BannerReveal',
  component: BannerReveal,
  args: { children: null },
  render: () => <TogglableBanner />,
} satisfies Meta<typeof BannerReveal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Toggle: Story = {};
