import '../src/index.css';
import { initSystemTheme } from '../src/lib/theme';
import { TooltipProvider } from '../src/components/ui/tooltip';
import type { Preview } from '@storybook/react-vite';

// Same call main.tsx makes before the app ever renders — without it, stories
// for anything under `.dark` styling would only ever show the light theme.
initSystemTheme();

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      // 'todo' - show a11y violations in the test UI only
      // 'error' - fail CI on a11y violations
      // 'off' - skip a11y checks entirely
      test: 'todo',
    },
  },
  // Mirrors App.tsx's own top-level wrapper — several components (e.g.
  // ContactRow's moderate/unmoderate button) render a Tooltip and expect a
  // provider above them.
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
};

export default preview;
