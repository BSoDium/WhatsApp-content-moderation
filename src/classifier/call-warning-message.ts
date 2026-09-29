import type { Ollama } from 'ollama';
import { createOllamaClient } from './ollama-client.ts';
import { detectLanguage } from './language.ts';
import { getNumberSetting } from '../store/settings.ts';
import { looksLikeRefusal, sanitizeWarning, warningModel } from './warning-text.ts';

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

function buildSystemPrompt(language: string): string {
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
    `- Write in ${language}.`,
    "- You have not been shown any conversation. Never mention, answer, or take a side on anything the contact wrote or on any person or topic they discussed.",
    '- Exactly ONE short sentence (two only if truly necessary), as brief as a real text message. No bullet points, no markdown, no surrounding quotation marks.',
    '- Firm and factual, never insulting or threatening beyond stating the actual consequence.',
    "- Respond with only the message text itself — no preamble.",
  ].join('\n');
}

function buildUserPrompt({ strikeCount, strikeThreshold }: CallWarningInput): string {
  const strikesRemaining = strikeThreshold - strikeCount;
  const consequence =
    strikesRemaining <= 0
      ? "You've reached the strike threshold — you are being blocked."
      : strikesRemaining === 1
        ? 'This is your last strike before you are blocked — one more nuisance call and you will be blocked.'
        : `${strikesRemaining} strikes remain before you are blocked.`;

  return [
    '# What happened',
    `Call strikes so far: ${strikeCount} of ${strikeThreshold}.`,
    `Consequence to state, addressed to the contact as "you": ${consequence}`,
    '',
    '# Task',
    'Write the reply to send back to them now.',
  ].join('\n');
}

/**
 * Generates the warning sent to a contact whose repeated unanswered calls were just flagged, written in
 * the language of their recent chat messages. Only detectLanguage sees those messages; the warning model
 * doesn't, so it can't engage with the conversation.
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
    const detected = await detectLanguage(input.recentMessages.join('\n'), ollama, model);
    if (!detected.ok) throw new Error(`language detection failed: ${detected.error}`);

    const response = await ollama.chat({
      model,
      messages: [
        { role: 'system', content: buildSystemPrompt(detected.language) },
        { role: 'user', content: buildUserPrompt(input) },
      ],
      options: { temperature: getNumberSetting('WARNING_TEMPERATURE') },
    });

    const text = sanitizeWarning(response.message.content, getNumberSetting('WARNING_MAX_LENGTH'));
    if (!text) throw new Error('empty call warning message generated');
    if (looksLikeRefusal(text)) throw new Error(`model refused to write the warning: ${text}`);

    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
