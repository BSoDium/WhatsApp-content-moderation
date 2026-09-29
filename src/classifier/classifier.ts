import type { Ollama } from 'ollama';
import { loadPolicy } from './policy.ts';
import { createOllamaClient } from './ollama-client.ts';
import { getRawSetting, getNumberSetting } from '../store/settings.ts';
import type { Classification } from '../types.ts';

export interface ConversationMessage {
  from: 'me' | 'them';
  text: string;
  automated?: boolean;
}

interface ClassifierInput {
  message: string;
  history?: ConversationMessage[];
  model?: string;
  // The contact's own moderation notes (monitored_contacts.context) — real
  // per-call input that varies per contact, not a test-injection point like
  // ClassifierDependencies.policy below.
  contactContext?: string;
}

interface ClassifierDependencies {
  client?: Ollama;
  policy?: string;
}

// Property order matters here: schema-constrained decoding fills fields in
// this order, so target/category/reason are written before flagged — the
// model commits to its reasoning first and then has to make flagged agree
// with it, instead of guessing flagged cold. target is never read back; it
// only forces the model to decide who a message is aimed at before judging it.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    target: { type: 'string', enum: ['me', 'someone_else', 'no_one'] },
    category: { type: 'string' },
    reason: { type: 'string' },
    flagged: { type: 'boolean' },
  },
  required: ['target', 'category', 'reason', 'flagged'],
};

function buildSystemPrompt(policy = loadPolicy(), contactContext?: string): string {
  return [
    "You are a content moderation filter for one specific person's personal WhatsApp chat.",
    "You will be shown recent conversation history for context, then the newest incoming message.",
    'Decide only whether that newest message violates the policy below — do not flag anything based on the history alone.',
    '"Me" is the person you protect and "Them" is the contact being moderated. Lines marked as automated warnings were sent by this system, not by Me.',
    'Profanity or insults only count when aimed at Me. Swearing for emphasis, venting about a third party or a situation, and banter or teasing Me took part in are not violations — use what Me wrote in the history to tell banter from abuse.',
    '',
    '# Policy',
    policy,
    ...(contactContext ? ['', '# Contact-specific context', contactContext] : []),
    '',
    'Respond with JSON only, matching the given schema. First set "target" to who the newest ' +
      'message is aimed at: "me", "someone_else", or "no_one" (no addressee, e.g. plain swearing). ' +
      'Then fill in "category" (a short label, e.g. "harassment", "unwanted_contact", or "none" ' +
      'when not flagged) and "reason" (one short sentence), then set "flagged" to agree with the ' +
      'reason you just wrote.',
  ].join('\n');
}

function speakerLabel({ from, automated }: ConversationMessage): string {
  if (from === 'them') return 'Them';
  return automated ? 'Me (automated warning, not written by me)' : 'Me';
}

function formatHistory(history: ConversationMessage[]): string {
  if (!history?.length) return '(no prior context)';
  return history.map((m) => `${speakerLabel(m)}: ${m.text}`).join('\n');
}

/**
 * Classifies the newest message from a contact against the configured
 * policy, using recent conversation history for context.
 *
 * Fails open by design: any error (Ollama unreachable, malformed response,
 * timeout) returns { ok: false } rather than a guessed verdict, so callers
 * must never delete/block on ok: false — see AGENTS.md's "Error handling".
 *
 * @param {{ message: string, history?: { from: 'me'|'them', text: string }[], model?: string, contactContext?: string }} input
 * @param {{ client?: Ollama, policy?: string }} [deps] - injectable for
 *   tests: `client` in place of a real Ollama connection, `policy` in place
 *   of reading the configured policy (which may not exist yet on a fresh
 *   install with no policy entered).
 * @returns {Promise<{ ok: true, flagged: boolean, category: string, reason: string } | { ok: false, error: string }>}
 */
export async function classifyMessage(
  { message, history = [], model = getRawSetting('OLLAMA_MODEL'), contactContext }: ClassifierInput,
  { client, policy }: ClassifierDependencies = {},
): Promise<Classification> {
  const ollama = client ?? createOllamaClient(getNumberSetting('CLASSIFIER_TIMEOUT_MS'));

  try {
    const response = await ollama.chat({
      model,
      messages: [
        { role: 'system', content: buildSystemPrompt(policy, contactContext) },
        {
          role: 'user',
          content: `# Recent conversation\n${formatHistory(history)}\n\n# Newest message to classify\nThem: ${message}`,
        },
      ],
      format: RESPONSE_SCHEMA,
      options: { temperature: 0 },
    });

    const parsed: unknown = JSON.parse(response.message.content);
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error(`malformed classifier response: ${response.message.content}`);
    }
    const result = parsed as Record<string, unknown>;
    if (typeof result.flagged !== 'boolean' || typeof result.category !== 'string') {
      throw new Error(`malformed classifier response: ${response.message.content}`);
    }

    return {
      ok: true,
      flagged: result.flagged,
      category: result.category,
      reason: typeof result.reason === 'string' ? result.reason : '',
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
