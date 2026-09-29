import type { Ollama } from 'ollama';
import { createOllamaClient } from './ollama-client.ts';
import { detectLanguage } from './language.ts';
import { getNumberSetting } from '../store/settings.ts';
import { looksLikeRefusal, sanitizeWarning, warningModel } from './warning-text.ts';

interface WarningMessageInput {
  message: string;
  strikeCount: number;
  strikeThreshold: number;
  model?: string;
}

interface WarningMessageDependencies {
  client?: Ollama;
}

type WarningMessageResult = { ok: true; text: string } | { ok: false; error: string };

function buildSystemPrompt(language: string): string {
  return [
    "You are an automated content-moderation system running on one specific person's personal WhatsApp account.",
    "A message from this contact was just removed from the chat for breaking the chat's rules.",
    "Write the notice this system sends back to the contact, right now, in the account owner's place.",
    '',
    'Every notice you write MUST include all three of these, in your own words:',
    "1. That their message was removed for breaking this chat's rules, with no detail about what the message said or why.",
    "2. An explicit statement that an automated system, not the account owner personally, is sending this and watching the conversation. A vague phrase like 'this conversation has been flagged' is NOT enough on its own — say outright that this is automated, not a person.",
    "3. The consequence exactly as given below, addressed to the contact as \"you\" — it is THEIR ability to message this number that is at stake, never phrase it as \"my account\" or \"the account\" being blocked, since that reads as the account owner's own account and makes no sense.",
    '',
    'Other requirements:',
    '- You have not been shown the conversation and know nothing about it. Never mention, quote, answer, or take a side on anything the contact wrote or on any person or topic they discussed. You only announce the removal and the consequence.',
    `- Write in ${language}.`,
    '- Exactly ONE short sentence (two only if truly necessary) — as brief as a real text message, never a paragraph. No bullet points, no headers, no markdown, no surrounding quotation marks.',
    '- Firm and factual, never insulting, sarcastic, or threatening beyond stating the actual consequence.',
    "- Respond with only the message text itself — no preamble like 'Here's a message:'.",
  ].join('\n');
}

function buildUserPrompt({ strikeCount, strikeThreshold }: WarningMessageInput): string {
  const strikesRemaining = strikeThreshold - strikeCount;
  const consequence =
    strikesRemaining <= 0
      ? "You've reached the strike threshold — this is your final warning before you are blocked."
      : strikesRemaining === 1
        ? 'This is your last strike before you are blocked — one more violation and you will be blocked.'
        : `${strikesRemaining} strikes remain before you are blocked.`;

  return [
    '# What happened',
    `Strikes so far: ${strikeCount} of ${strikeThreshold}.`,
    `Consequence to state, addressed to the contact as "you": ${consequence}`,
    '',
    '# Task',
    'Write the notice to send back to them now.',
  ].join('\n');
}

/**
 * Generates the warning sent to a contact whose message was just flagged and
 * deleted, written in that message's language, telling the contact plainly
 * that an automated system is watching and will block them if it continues.
 * The warning model never sees the flagged message (only detectLanguage
 * does), so it can't engage with the conversation.
 *
 * Fails open by design, same contract as classifyMessage: any error (Ollama
 * unreachable, malformed/empty response, timeout) returns { ok: false }
 * rather than a guessed message. Callers must fall back to a static default
 * on ok:false — see moderation-pipeline.ts's FALLBACK_WARNING_MESSAGE — never
 * skip sending a warning entirely, since the contact still needs to be told
 * their message was removed.
 *
 * @param {{ message: string, strikeCount: number, strikeThreshold: number, model?: string }} input
 * @param {{ client?: Ollama }} [deps] - injectable Ollama client for tests.
 * @returns {Promise<{ ok: true, text: string } | { ok: false, error: string }>}
 */
export async function generateWarningMessage(
  input: WarningMessageInput,
  { client }: WarningMessageDependencies = {},
): Promise<WarningMessageResult> {
  const { model = warningModel() } = input;
  const ollama = client ?? createOllamaClient(getNumberSetting('WARNING_TIMEOUT_MS'));

  try {
    const detected = await detectLanguage(input.message, ollama, model);
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
    if (!text) throw new Error('empty warning message generated');
    if (looksLikeRefusal(text)) throw new Error(`model refused to write the warning: ${text}`);

    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
