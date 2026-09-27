import { Ollama } from 'ollama';

interface WarningMessageInput {
  message: string;
  category: string;
  reason: string;
  strikeCount: number;
  strikeThreshold: number;
  model?: string;
}

interface WarningMessageDependencies {
  client?: Ollama;
}

type WarningMessageResult = { ok: true; text: string } | { ok: false; error: string };

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
// Falls back to the classifier's own model — same local Ollama install, no extra pull required —
// but overridable independently since generation and classification are different tasks.
const MODEL = process.env.WARNING_MODEL ?? process.env.OLLAMA_MODEL ?? 'llama3.2:3b';
const DEFAULT_TIMEOUT_MS = 90_000;
const TIMEOUT_MS = Number(process.env.WARNING_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
const DEFAULT_TEMPERATURE = 0.4;
const TEMPERATURE = Number(process.env.WARNING_TEMPERATURE ?? DEFAULT_TEMPERATURE);
// A hard ceiling, not a target length — small local models asked for "a short message" still
// occasionally ramble, and this is what actually gets sent to a real person's phone.
const DEFAULT_MAX_LENGTH = 320;
const MAX_LENGTH = Number(process.env.WARNING_MAX_LENGTH ?? DEFAULT_MAX_LENGTH);

function buildSystemPrompt(): string {
  return [
    "You are an automated content-moderation system running on one specific person's personal WhatsApp account.",
    'A message from this contact was just detected as violating that policy and has already been deleted from the chat.',
    'Write the message this system sends back to the contact, right now, in the account owner\'s place.',
    '',
    'Every message you write MUST include all three of these, in your own words:',
    "1. A concrete, specific instruction to stop the exact behavior described below — never generic ('stop sending threatening messages', not 'please be respectful').",
    "2. An explicit statement that an automated system, not the account owner personally, is sending this and watching the conversation. A vague phrase like 'this conversation has been flagged' is NOT enough on its own — say outright that this is automated, not a person.",
    '3. The consequence exactly as given below (imminent block, one strike left, or strikes remaining) — never soften or omit it.',
    '',
    'Other requirements:',
    '- Describe the violation using the reason given below, in your own plain words — do not invent a different or more severe-sounding violation than what actually happened.',
    '- 1-3 short sentences, like a real text message a person could plausibly send — no bullet points, no headers, no markdown, no surrounding quotation marks.',
    '- Firm and factual, never insulting, sarcastic, or threatening beyond stating the actual consequence.',
    "- Respond with only the message text itself — no preamble like 'Here's a message:'.",
  ].join('\n');
}

function buildUserPrompt({ category, reason, strikeCount, strikeThreshold }: WarningMessageInput): string {
  const strikesRemaining = strikeThreshold - strikeCount;
  const consequence =
    strikesRemaining <= 0
      ? 'This contact has reached the strike threshold — this is their final warning before being blocked.'
      : strikesRemaining === 1
        ? 'This is their last strike before being blocked — one more violation blocks them.'
        : `${strikesRemaining} strikes remain before this contact is blocked.`;

  return [
    '# What happened',
    `Category: ${category}`,
    `Reason: ${reason}`,
    `Strikes so far: ${strikeCount} of ${strikeThreshold}.`,
    `Consequence to state: ${consequence}`,
    '',
    '# Task',
    'Write the reply to send back to them now.',
  ].join('\n');
}

// Collapses whatever formatting a small local model adds (surrounding quotes, stray newlines,
// multiple spaces) down to the single plain line an actual text message would be.
function sanitize(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  const unquoted = collapsed.replace(/^["'“‘`]+/, '').replace(/["'”’`]+$/, '').trim();
  return unquoted.length > MAX_LENGTH ? `${unquoted.slice(0, MAX_LENGTH - 1).trimEnd()}…` : unquoted;
}

/**
 * Generates a contextual warning message to send back to a contact whose
 * message was just flagged and deleted, instead of a single static string —
 * the reply names the actual violation and tells the contact plainly that an
 * automated system is watching and will block them if it continues.
 *
 * Fails open by design, same contract as classifyMessage: any error (Ollama
 * unreachable, malformed/empty response, timeout) returns { ok: false }
 * rather than a guessed message. Callers must fall back to a static default
 * on ok:false — see moderation-pipeline.ts's FALLBACK_WARNING_MESSAGE — never
 * skip sending a warning entirely, since the contact still needs to be told
 * their message was removed.
 *
 * @param {{ message: string, category: string, reason: string, strikeCount: number, strikeThreshold: number, model?: string }} input
 * @param {{ client?: Ollama }} [deps] - injectable Ollama client for tests.
 * @returns {Promise<{ ok: true, text: string } | { ok: false, error: string }>}
 */
export async function generateWarningMessage(
  input: WarningMessageInput,
  { client }: WarningMessageDependencies = {},
): Promise<WarningMessageResult> {
  const { model = MODEL } = input;
  const ollama = client ?? new Ollama({
    host: OLLAMA_HOST,
    fetch: (fetchInput, init) => fetch(fetchInput, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) }),
  });

  try {
    const response = await ollama.chat({
      model,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserPrompt(input) },
      ],
      options: { temperature: TEMPERATURE },
    });

    const text = sanitize(response.message.content);
    if (!text) throw new Error('empty warning message generated');

    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
