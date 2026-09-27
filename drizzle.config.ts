import { defineConfig } from 'drizzle-kit';

// A default export, against this repo's named-exports convention, because
// drizzle-kit only reads a config file's default export.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/store/schema.ts',
  out: './drizzle',
});
