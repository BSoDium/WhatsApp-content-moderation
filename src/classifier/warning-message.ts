import type { Ollama } from 'ollama';
import { createOllamaClient } from './ollama-client.ts';
import { detectLanguage } from './language.ts';
import { getNumberSetting } from '../store/settings.ts';
import { generateChecked, warningModel } from './warning-text.ts';
import { describeConsequence, NO_STRIKE_WORDING_RULE } from './warning-consequence.ts';
import type { BlockOutlook } from './warning-consequence.ts';
import { templateWarning } from './warning-templates.ts';

interface WarningMessageInput {
  message: string;
  strikeCount: number;
  strikeThreshold: number;
  blockOutlook?: BlockOutlook;
  model?: string;
}

interface WarningMessageDependencies {
  client?: Ollama;
}

type WarningMessageResult = { ok: true; text: string } | { ok: false; error: string };

function buildSystemPrompt(language: string, hasConsequence: boolean): string {
  return [
    "You are an automated content-moderation system running on one specific person's personal WhatsApp account.",
    'A message from this contact was just removed from your private one-to-one conversation for breaking its rules.',
    "Write the short notice this system sends back to the contact, right now, in the account owner's place.",
    '',
    `Every notice you write MUST include ${hasConsequence ? 'all three' : 'both'} of these, in your own words:`,
    "1. That their message was removed for breaking this conversation's rules, with no detail about what the message said or why.",
    '2. That this is an automated message, not the account owner personally.',
    ...(hasConsequence
      ? ['3. The consequence exactly as given below, addressed to the contact as "you" — it is THEIR ability to message this number that is at stake, never phrase it as "my account" or "the account" being blocked.']
      : ['Do not mention blocking, bans or any other penalty: none applies to this contact.']),
    '',
    'Other requirements:',
    '- You have not been shown the conversation and know nothing about it. Never mention, quote, answer, or take a side on anything the contact wrote or on any person or topic they discussed.',
    '- This is a private conversation between two people, never a group: do not write "group".',
    `- ${NO_STRIKE_WORDING_RULE}`,
    `- Write in ${language}.`,
    '- At most two short sentences and under 160 characters, as brief as a real text message. No emoji, bullet points, headers, markdown, or surrounding quotation marks.',
    '- Firm and factual, never insulting, sarcastic, or threatening beyond stating the actual consequence.',
    "- Respond with only the message text itself — no preamble like 'Here's a message:'.",
    '',
    'Example of the expected shape (in English; write yours in the language above):',
    hasConsequence
      ? "Your message was removed for breaking this conversation's rules. This is an automated message, not the account owner: the next repeat offence will get you blocked."
      : "Your message was removed for breaking this conversation's rules. This is an automated message, not the account owner.",
  ].join('\n');
}

function consequenceLine(consequence: string | null): string {
  return consequence ? `Consequence to state, addressed to the contact as "you": ${consequence}` : 'No consequence applies: do not mention blocking or any penalty.';
}

function buildUserPrompt({ strikeCount, strikeThreshold, blockOutlook }: WarningMessageInput, retryHint: string | null): string {
  return [
    '# What happened',
    consequenceLine(describeConsequence(strikeThreshold - strikeCount, blockOutlook)),
    '',
    '# Task',
    'Write the notice to send back to them now.',
    ...(retryHint ? ['', '# Correction', retryHint] : []),
  ].join('\n');
}

/**
 * Generates the warning sent to a contact whose message was just flagged and
 * deleted, written in that message's language, telling the contact plainly
 * that an automated system is watching and will block them if it continues.
 * A language with a hand-written entry in warning-templates.ts gets that
 * fixed text, with no generation call at all; any other language is written
 * by the warning model. That model never sees the flagged message (only
 * detectLanguage does), so it can't engage with the conversation.
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

    const fixedText = templateWarning(detected.language, 'message', input.strikeThreshold - input.strikeCount, input.blockOutlook);
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
