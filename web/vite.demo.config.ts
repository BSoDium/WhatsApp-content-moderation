import { renameSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const DEMO_ROOT = fileURLToPath(new URL('.', import.meta.url))

// Builds demo.html as the site root (index.html) into dist-demo/, never touching dist/ that the container image copies.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'demo-html-as-index',
      closeBundle() {
        renameSync(`${DEMO_ROOT}dist-demo/demo.html`, `${DEMO_ROOT}dist-demo/index.html`)
      },
    },
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    outDir: 'dist-demo',
    emptyOutDir: true,
    rollupOptions: { input: `${DEMO_ROOT}demo.html` },
  },
})
