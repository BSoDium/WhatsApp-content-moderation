import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POLICY_PATH = join(__dirname, '..', '..', 'config', 'policy.md');
const EXAMPLE_PATH = join(__dirname, '..', '..', 'config', 'policy.example.md');

let cached;

// Loaded lazily (not at import time) so every caller gets the same clear
// error instead of an import-time crash, and so tests can stub it easily.
export function loadPolicy() {
  if (cached) return cached;

  if (!existsSync(POLICY_PATH)) {
    throw new Error(
      `Missing config/policy.md. This defines what the classifier flags and ` +
        `is gitignored on purpose, since it describes a real person. Copy ` +
        `${EXAMPLE_PATH} to config/policy.md and fill it in before running the classifier.`,
    );
  }

  const text = readFileSync(POLICY_PATH, 'utf-8').trim();
  if (!text) {
    throw new Error('config/policy.md is empty — fill it in before running the classifier.');
  }

  cached = text;
  return cached;
}
