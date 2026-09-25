import { Ollama } from 'ollama';
import { loadPolicy } from './policy.js';

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
// See README "Classifier" for why 3b, not the cheaper 1b, is the default.
const MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2:3b';
const TIMEOUT_MS = Number(process.env.CLASSIFIER_TIMEOUT_MS ?? 15000);

// Property order matters here: schema-constrained decoding fills fields in
// this order, so category/reason are written before flagged — the model
// commits to its reasoning first and then has to make flagged agree with
// it, instead of guessing flagged cold.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string' },
    reason: { type: 'string' },
    flagged: { type: 'boolean' },
  },
  required: ['category', 'reason', 'flagged'],
};

function buildSystemPrompt() {
  return [
    "You are a content moderation filter for one specific person's personal WhatsApp chat.",
    "You will be shown recent conversation history for context, then the newest incoming message.",
    'Decide only whether that newest message violates the policy below — do not flag anything based on the history alone.',
    '',
    '# Policy',
    loadPolicy(),
    '',
    'Respond with JSON only, matching the given schema. Fill in "category" (a short label, ' +
      'e.g. "harassment", "unwanted_contact", or "none" when not flagged) and "reason" (one ' +
      'short sentence) first, then set "flagged" to agree with the reason you just wrote.',
  ].join('\n');
}

function formatHistory(history) {
  if (!history?.length) return '(no prior context)';
  return history.map((m) => `${m.from === 'me' ? 'Me' : 'Them'}: ${m.text}`).join('\n');
}

/**
 * Classifies the newest message from a contact against the configured
 * policy, using recent conversation history for context.
 *
 * Fails open by design: any error (Ollama unreachable, malformed response,
 * timeout) returns { ok: false } rather than a guessed verdict, so callers
 * must never delete/block on ok: false — see AGENTS.md's "Error handling".
 *
 * @param {{ message: string, history?: { from: 'me'|'them', text: string }[], model?: string }} input
 * @returns {Promise<{ ok: true, flagged: boolean, category: string, reason: string } | { ok: false, error: string }>}
 */
export async function classifyMessage({ message, history = [], model = MODEL }) {
  const ollama = new Ollama({ host: OLLAMA_HOST });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await ollama.chat({
      model,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        {
          role: 'user',
          content: `# Recent conversation\n${formatHistory(history)}\n\n# Newest message to classify\nThem: ${message}`,
        },
      ],
      format: RESPONSE_SCHEMA,
      options: { temperature: 0 },
      signal: controller.signal,
    });

    const parsed = JSON.parse(response.message.content);
    if (typeof parsed.flagged !== 'boolean' || typeof parsed.category !== 'string') {
      throw new Error(`malformed classifier response: ${response.message.content}`);
    }

    return { ok: true, flagged: parsed.flagged, category: parsed.category, reason: parsed.reason ?? '' };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  } finally {
    clearTimeout(timeout);
  }
}
