/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/web/index.html', './src/web/app.js'],
  darkMode: 'media',
  theme: {
    extend: {
      fontFamily: {
        mono: ['ui-monospace', 'SF Mono', 'Roboto Mono', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
