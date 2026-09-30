import type { Ollama } from 'ollama';
import { createOllamaClient } from './ollama-client.ts';
import { detectLanguage } from './language.ts';
import { getNumberSetting } from '../store/settings.ts';
import { describeConsequence, NO_STRIKE_WORDING_RULE } from './warning-consequence.ts';
import type { BlockOutlook } from './warning-consequence.ts';
import { templateWarning } from './warning-templates.ts';
import { generateChecked, warningModel } from './warning-text.ts';

interface CallWarningInput {
  recentMessages: string[];
  strikeCount: number;
  strikeThreshold: number;
  blockOutlook?: BlockOutlook;
  model?: string;
}

interface CallWarningDependencies {
  client?: Ollama;
}

type CallWarningResult = { ok: true; text: string } | { ok: false; error: string };

function buildSystemPrompt(language: string, hasConsequence: boolean): string {
  return [
    "You are an automated moderation system running on one specific person's personal WhatsApp account.",
    'A contact keeps calling that account repeatedly without the calls being answered, and this system has just rejected their latest call.',
    "Write the message this system sends back to the contact, right now, in the account owner's place.",
    '',
    'The message MUST, in your own words:',
    '1. Ask them to stop calling repeatedly without a reply.',
    '2. Say plainly that an automated system, not the account owner personally, is sending this.',
    ...(hasConsequence
      ? ['3. State the consequence exactly as given below, addressed to the contact as "you".']
      : ['Do not mention blocking, bans or any other penalty: none applies to this contact.']),
    '',
    'Other requirements:',
    `- ${NO_STRIKE_WORDING_RULE}`,
    `- Write in ${language}.`,
    "- You have not been shown any conversation. Never mention, answer, or take a side on anything the contact wrote or on any person or topic they discussed.",
    '- Exactly ONE short sentence (two only if truly necessary), as brief as a real text message. No bullet points, no markdown, no surrounding quotation marks.',
    '- Firm and factual, never insulting or threatening beyond stating the actual consequence.',
    "- Respond with only the message text itself — no preamble.",
  ].join('\n');
}

function buildUserPrompt({ strikeCount, strikeThreshold, blockOutlook }: CallWarningInput, retryHint: string | null): string {
  const consequence = describeConsequence(strikeThreshold - strikeCount, blockOutlook);
  return [
    '# What happened',
    consequence
      ? `Consequence to state, addressed to the contact as "you": ${consequence}`
      : 'No consequence applies: do not mention blocking or any penalty.',
    '',
    '# Task',
    'Write the reply to send back to them now.',
    ...(retryHint ? ['', '# Correction', retryHint] : []),
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

    const fixedText = templateWarning(detected.language, 'call', input.strikeThreshold - input.strikeCount, input.blockOutlook);
    if (fixedText) return { ok: true, text: fixedText };

    return await generateChecked(async (retryHint) => {
      const response = await ollama.chat({
        model,
        messages: [
          { role: 'system', content: buildSystemPrompt(detected.language, describeConsequence(input.strikeThreshold - input.strikeCount, input.blockOutlook) !== null) },
          { role: 'user', content: buildUserPrompt(input, retryHint) },
        ],
        options: { temperature: getNumberSetting('WARNING_TEMPERATURE') },
      });
      return response.message.content;
    }, getNumberSetting('WARNING_MAX_LENGTH'));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
