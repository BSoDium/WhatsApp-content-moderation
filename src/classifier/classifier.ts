import type { Ollama } from 'ollama';
import { loadPolicy } from './policy.ts';
import { createOllamaClient } from './ollama-client.ts';
import { getRawSetting, getNumberSetting } from '../store/settings.ts';
import type { Classification } from '../types.ts';

export interface ConversationMessage {
  from: 'me' | 'them';
  text: string;
  automated?: boolean;
  removedAs?: string;
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
// with it, instead of guessing flagged cold. user_was_rude and target are never
// read back; they force a small model to answer two narrow questions — did
// the user set a rude tone, who is this aimed at — instead of skipping the history.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    user_was_rude: { type: 'boolean' },
    words_addressing_user: { type: 'string' },
    target: { type: 'string', enum: ['user', 'someone_else', 'no_one'] },
    category: { type: 'string' },
    reason: { type: 'string' },
    flagged: { type: 'boolean' },
  },
  required: ['user_was_rude', 'words_addressing_user', 'target', 'category', 'reason', 'flagged'],
};

function buildSystemPrompt(policy = loadPolicy(), contactContext?: string): string {
  return [
    "You are a content moderation filter for one specific person's personal WhatsApp chat.",
    "You will be shown recent conversation history for context, then the newest incoming message.",
    'Decide only whether that newest message violates the policy below — do not flag anything based on the history alone.',
    'The person you protect is "the user" and "Contact" is the person being moderated. The policy and the contact-specific context below are written by the user in the first person: "me", "my" and "I" in them mean the user. Lines marked as automated warnings were sent by this system, not by the user.',
    'Every line is labelled with who wrote it. "User" lines are written by the protected person, never by Contact. Apply this in whatever language the messages are written in: in a "Contact" line, first-person words (I, me, my, je, moi, ma, yo, mi, ich, mein…) always refer to Contact, and only second-person words (you, your, tu, toi, ton, vous, tú, ti, du, dein…) or the user\'s name refer to the user. A Contact line asking for help, or talking about "my" feelings, is Contact talking about themself, not the user.',
    'Some Contact lines are marked "(removed by moderation: ...)": they were already judged a violation and deleted. A newest message that continues, completes or rephrases such a line — the same sentence split across messages, or the same pressure repeated — is part of the same violation and gets flagged with the same category, even if it looks harmless on its own.',
    'Profanity or insults only count when aimed at the user. Swearing for emphasis and venting about a third party or a situation are not violations.',
    'An insult only counts when it targets the user directly: "you"/"tu"/"toi", the user\'s name, or a name-calling word addressed to the user. A short remark that judges a situation, an idea or a thing is about that thing, not about the user.',
    'Friendly greetings and sign-offs are never advances, in any language: "bisous", "bises", "bizou", "xoxo", kiss or heart emojis. Only flag affection when it is clearly sexual or continues after the user asked them to stop.',
    'If the user was already rude, insulting or teasing in the recent conversation, mutual banter is not a violation either. Only flag it then if the newest message is a real threat, sexually explicit, or keeps pressuring the user after a clear refusal.',
    '',
    '# Examples',
    'Recent conversation: "User: you missed your bus again, what a dummy 😂" / "Contact: haha I overslept". Newest message: "Contact: screw you, at least I got up" -> user_was_rude true, banter, flagged false.',
    'Recent conversation: "User: thanks, talk later". Newest message: "Contact: you are useless and nobody likes you" -> user_was_rude false, aimed at the user, flagged true.',
    'Recent conversation: "Contact: sinon tu comprendrais mon amour (removed by moderation: unwanted_contact)". Newest message: "Contact: ma sensibilité." -> finishes the removed sentence, same violation, flagged true.',
    'Recent conversation: "Contact: sinon tu comprendrais mon amour (removed by moderation: unwanted_contact)". Newest message: "Contact: aide moi" -> keeps pressuring the user after a removed message, flagged true.',
    'Recent conversation: (none). Newest message: "Contact: aide moi, ma voiture ne démarre pas" -> Contact asking for help for themself, flagged false.',
    'Recent conversation: (none). Newest message: "Contact: ayúdame, mi coche no arranca" -> same in Spanish, flagged false.',
    'Recent conversation: (none). Newest message: "Contact: this stupid printer is broken again, damn it" -> aimed at no one, flagged false.',
    'Recent conversation: (none). Newest message: "Contact: c\'est nul comme idée" -> about the idea, not about the user, flagged false.',
    'Recent conversation: (none). Newest message: "Contact: à demain, gros bisous 😘" -> friendly sign-off, flagged false.',
    '',
    '# Policy',
    policy,
    ...(contactContext ? ['', '# Contact-specific context', contactContext] : []),
    '',
    'Respond with JSON only, matching the given schema. First set "user_was_rude" to true if a line ' +
      'written by the user (not an automated warning) in the recent conversation was rude, insulting or ' +
      'teasing, else false. Then set "words_addressing_user" to the exact words of the newest message ' +
      'that refer to the user directly ("you", "tu", "toi", the user\'s name), or an empty string if there are none. ' +
      'Then set "target" to who the newest message is aimed at: "user" ' +
      '(including "you"/"tu"/"toi"), "someone_else", or "no_one" (no addressee, e.g. plain swearing). ' +
      'Then fill in "category" (a short label, e.g. "harassment", "unwanted_contact", or "none" ' +
      'when not flagged) and "reason" (one short sentence that refers to the protected person as "the user"), then set "flagged" to agree with the ' +
      'reason you just wrote.',
  ].join('\n');
}

function speakerLabel({ from, automated, removedAs }: ConversationMessage): string {
  if (from === 'them') return removedAs ? `Contact (removed by moderation: ${removedAs})` : 'Contact';
  return automated ? 'User (automated warning, not written by the user)' : 'User';
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
          content: `# Recent conversation\n${formatHistory(history)}\n\n# Newest message to classify\nContact: ${message}`,
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
