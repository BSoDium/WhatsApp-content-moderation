import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Exported so .storybook/main.ts can reuse this path instead of hand-copying it (it can't merge in this file's `plugins` wholesale — see main.ts).
export const srcAlias = { '@': fileURLToPath(new URL('./src', import.meta.url)) }

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: srcAlias,
  },
})
