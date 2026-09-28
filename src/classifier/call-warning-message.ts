import type { Ollama } from 'ollama';
import { createOllamaClient } from './ollama-client.ts';
import { getNumberSetting } from '../store/settings.ts';
import { sanitizeWarning, warningModel } from './warning-text.ts';

interface CallWarningInput {
  recentMessages: string[];
  strikeCount: number;
  strikeThreshold: number;
  model?: string;
}

interface CallWarningDependencies {
  client?: Ollama;
}

type CallWarningResult = { ok: true; text: string } | { ok: false; error: string };

function buildSystemPrompt(): string {
  return [
    "You are an automated moderation system running on one specific person's personal WhatsApp account.",
    'A contact keeps calling that account repeatedly without the calls being answered, and this system has just rejected their latest call.',
    "Write the message this system sends back to the contact, right now, in the account owner's place.",
    '',
    'The message MUST, in your own words:',
    '1. Ask them to stop calling repeatedly without a reply.',
    '2. Say plainly that an automated system, not the account owner personally, is sending this.',
    '3. State the consequence exactly as given below, addressed to the contact as "you".',
    '',
    'Other requirements:',
    "- Reply in the same language as the recent messages the contact wrote (e.g. French for French messages) — never translate to English unless they write English.",
    '- Exactly ONE short sentence (two only if truly necessary), as brief as a real text message. No bullet points, no markdown, no surrounding quotation marks.',
    '- Firm and factual, never insulting or threatening beyond stating the actual consequence.',
    "- Respond with only the message text itself — no preamble.",
  ].join('\n');
}

function buildUserPrompt({ recentMessages, strikeCount, strikeThreshold }: CallWarningInput): string {
  const strikesRemaining = strikeThreshold - strikeCount;
  const consequence =
    strikesRemaining <= 0
      ? "You've reached the strike threshold — you are being blocked."
      : strikesRemaining === 1
        ? 'This is your last strike before you are blocked — one more nuisance call and you will be blocked.'
        : `${strikesRemaining} strikes remain before you are blocked.`;

  return [
    '# Recent messages from this contact (for language and tone reference — do not quote them back)',
    ...recentMessages.map((message) => `- ${message}`),
    '',
    '# What happened',
    `Call strikes so far: ${strikeCount} of ${strikeThreshold}.`,
    `Consequence to state, addressed to the contact as "you": ${consequence}`,
    '',
    '# Task',
    "Write the reply to send back to them now, in the same language as their recent messages above.",
  ].join('\n');
}

/**
 * Generates the warning sent to a contact whose repeated unanswered calls were just flagged, written in
 * the language of their recent chat messages.
 *
 * Fails open like generateWarningMessage: any error (Ollama unreachable, empty response, timeout) returns
 * { ok: false } rather than a guessed message, and the caller must fall back to the configured static
 * NUISANCE_CALL_WARNING_MESSAGE — never skip the warning.
 */
export async function generateCallWarningMessage(
  input: CallWarningInput,
  { client }: CallWarningDependencies = {},
): Promise<CallWarningResult> {
  const { model = warningModel() } = input;
  const ollama = client ?? createOllamaClient(getNumberSetting('WARNING_TIMEOUT_MS'));

  try {
    const response = await ollama.chat({
      model,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserPrompt(input) },
      ],
      options: { temperature: getNumberSetting('WARNING_TEMPERATURE') },
    });

    const text = sanitizeWarning(response.message.content, getNumberSetting('WARNING_MAX_LENGTH'));
    if (!text) throw new Error('empty call warning message generated');

    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
