import tailwindcss from '@tailwindcss/vite';
import { mergeConfig } from 'vite';
import type { StorybookConfig } from '@storybook/react-vite';
import { srcAlias } from '../vite.config.ts';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-docs'],
  framework: '@storybook/react-vite',
  async viteFinal(viteConfig) {
    // Only the alias is reused from vite.config.ts, not its `plugins` — that array's react() would double up with the one @storybook/react-vite already supplies.
    return mergeConfig(viteConfig, {
      plugins: [tailwindcss()],
      resolve: { alias: srcAlias },
    });
  },
};

export default config;
