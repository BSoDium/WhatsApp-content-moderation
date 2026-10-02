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
// this order, so each step of the decision procedure in buildSystemPrompt is
// answered before flagged, and the model has to make flagged agree with its
// own earlier answers instead of guessing it cold. Only flagged, category and
// reason are read back; the others exist to force narrow questions a small
// model answers reliably (was the user rude, is this a reply in kind, who is
// it aimed at) instead of skipping the history.
const BANTER_PROPERTIES = {
  is_mutual_banter: { type: 'boolean' },
};

const VERDICT_PROPERTIES = {
  words_addressing_user: { type: 'string' },
  target: { type: 'string', enum: ['user', 'someone_else', 'no_one'] },
  category: { type: 'string' },
  reason: { type: 'string' },
  flagged: { type: 'boolean' },
};

// Without a line from the user there is nothing to answer back to, so the banter questions are dropped rather than asked: a small model otherwise invents a rude user line and lets the invention excuse the contact.
function responseSchema(userHasSpoken: boolean) {
  const properties = userHasSpoken ? { ...BANTER_PROPERTIES, ...VERDICT_PROPERTIES } : VERDICT_PROPERTIES;
  return { type: 'object', properties, required: Object.keys(properties) };
}

function userHasSpoken(history: ConversationMessage[]): boolean {
  return history.some((m) => m.from === 'me' && !m.automated);
}

const BANTER_STEPS = [
  'is_mutual_banter: true only if BOTH hold: an earlier "User" line (not an automated warning) insulted, teased or swore at Contact, AND the newest message is just an insult, tease or swear thrown back in the same spirit. A friendly, neutral or polite User line — including asking Contact to stop or leave them alone — does not count as teasing.',
];

const VERDICT_STEPS = [
  'words_addressing_user: the exact words of the newest message that address the user — a second-person pronoun or verb form in any language (contractions count: you\'re, t\'es, tu es, du bist), or the user\'s name. Adjectives and nouns alone ("stupid", "nul", "idea") do not address anyone, and neither does a sentence about another person. Empty string if there are none.',
  'target: who the newest message is aimed at — "user" if it addresses the user or calls them a name; "someone_else" if it is about another person ("my boss", "mon voisin", "he", "elle", "el vecino", a named third party), however harsh; or "no_one" (plain swearing, or a remark about a situation, an idea or a thing).',
  'category and reason, then flagged.',
];

function decisionSteps(userSpoke: boolean): string[] {
  const steps = userSpoke ? [...BANTER_STEPS, ...VERDICT_STEPS] : VERDICT_STEPS;
  return steps.map((step, i) => `${i + 1}. ${step}`);
}

const COMMON_FLAG_RULES =
  'Swearing for emphasis and venting about a third party or a situation are never violations. Friendly greetings and sign-offs are never advances, in any language and whatever the local convention (e.g. "xoxo", "bisous", "besos", "Küsschen", "abraços"), nor are kiss or heart emojis; only flag affection that is clearly sexual or continues after the user asked them to stop. A question that carries no blame, order or demand ("tu as mangé ?", "tu es à la maison ?") is never guilt-tripping. What the user wrote about Contact in earlier lines is the user\'s opinion, not evidence: judge the newest message on its own words. Never flag a statement for being false or inconsistent: you cannot verify what Contact says. Otherwise, flag the message if it violates the policy below.';

function flaggedRule(userSpoke: boolean): string {
  const exceptions = 'a real threat, a sexually explicit message, pressure on the user after a clear refusal that asks or orders the user to do something, and a fragment that finishes the line just removed by moderation';
  return userSpoke
    ? `flagged must be false when target is not "user" and when is_mutual_banter is true, with these exceptions, which are flagged whatever the target: ${exceptions}. ${COMMON_FLAG_RULES}`
    : `flagged must be false when target is not "user", with these exceptions, which are flagged whatever the target: ${exceptions}. ${COMMON_FLAG_RULES}`;
}

const BANTER_EXAMPLES = [
  'Recent conversation: "User: you missed your bus again, what a dummy 😂" / "Contact: haha I overslept". Newest message: "Contact: screw you, at least I got up" -> is_mutual_banter true, flagged false.',
  'Recent conversation: "User: thanks, talk later". Newest message: "Contact: you are useless and nobody likes you" -> is_mutual_banter false, target user, flagged true.',
  'Recent conversation: "User: not now, please leave me alone". Newest message: "Contact: reply to me, you coward" -> the user was polite, not teasing: is_mutual_banter false, target user, flagged true.',
  'Recent conversation: "User: lol nice haircut 😂". Newest message: "Contact: I will hurt you if you come near me" -> is_mutual_banter false (a real threat), flagged true.',
];

const EXAMPLES = [
  'Recent conversation: "Contact: sinon tu comprendrais mon amour (removed by moderation: unwanted_contact)". Newest message: "Contact: ma sensibilité." -> finishes the removed sentence, same violation, flagged true.',
  'Recent conversation: "Contact: sinon tu comprendrais mon amour (removed by moderation: unwanted_contact)". Newest message: "Contact: aide moi" -> keeps pressuring the user after a removed message, flagged true.',
  'Recent conversation: (none). Newest message: "Contact: aide moi, ma voiture ne démarre pas" -> Contact asking for help for themself, flagged false.',
  'Recent conversation: (none). Newest message: "Contact: ayúdame, mi coche no arranca" -> same in Spanish, flagged false.',
  'Recent conversation: (none). Newest message: "Contact: il mio capo è un vero stronzo, non lo sopporto" -> about a third person, words_addressing_user empty, target someone_else, flagged false.',
  'Recent conversation: (none). Newest message: "Contact: this stupid printer is broken again, damn it" -> words_addressing_user empty, target no_one, flagged false.',
  'Recent conversation: (none). Newest message: "Contact: c\'est nul comme idée" -> words_addressing_user empty, about the idea, target no_one, flagged false.',
  'Recent conversation: (none). Newest message: "Contact: à demain, gros bisous 😘" -> friendly sign-off, flagged false.',
  'Recent conversation: (none). Newest message: "Contact: hasta mañana, un besazo" -> friendly sign-off in Spanish, flagged false.',
  'Recent conversation: (none). Newest message: "Contact: du bist so ein Idiot" -> words_addressing_user "du", target user, flagged true.',
  'Recent conversation: (none). Newest message: "Contact: t\'es qu\'une merde" -> words_addressing_user "t\'es", target user, flagged true.',
];

function buildSystemPrompt(policy = loadPolicy(), contactContext?: string, userSpoke = true): string {
  return [
    "You are a content moderation filter for one specific person's personal WhatsApp chat. Messages may be in any language.",
    '',
    '# Who is who',
    'Two people talk in this chat. "User" is the person you protect. "Contact" is the person being moderated. Every line is labelled with who wrote it, and the newest message is always written by Contact.',
    'Lines marked as automated warnings were sent by this system, not by the user.',
    'The policy and the contact-specific context below are written by the user in the first person: "me", "my" and "I" in them mean the user.',
    'In a Contact line, first-person words (I, me, my, je, moi, ma, yo, mi, ich, mein…) refer to Contact. Only second-person words (you, your, tu, toi, ton, vous, tú, ti, du, dein…) or the user\'s name refer to the user. A Contact line asking for help or talking about "my" feelings is Contact talking about themself.',
    'Some Contact lines are marked "(removed by moderation: ...)": they were already judged a violation and deleted. Only a newest message that finishes such a line, or repeats or rephrases the same demand, is part of the same violation and gets flagged with the same category; a message about something else is judged by the policy alone.',
    '',
    '# How to decide, in this order',
    ...decisionSteps(userSpoke),
    '',
    flaggedRule(userSpoke),
    '',
    '# Examples',
    ...EXAMPLES,
    ...(userSpoke ? BANTER_EXAMPLES : []),
    '',
    '# Policy',
    policy,
    ...(contactContext ? ['', '# Contact-specific context', contactContext] : []),
    '',
    'Respond with JSON only, matching the given schema, filling the fields in the order above. "category" is a short label (e.g. "harassment", "unwanted_contact", or "none" when not flagged). "reason" is one short sentence starting with "the contact" and saying what they did; "the user" is only ever the protected person. Set "flagged" last, to agree with everything you wrote before it.',
  ].join('\n');
}

function speakerLabel({ from, automated, removedAs }: ConversationMessage): string {
  if (from === 'them') return removedAs ? `Contact (removed by moderation: ${removedAs})` : 'Contact';
  return automated ? 'User (automated warning, not written by the user)' : 'User';
}

function followUpNote(history: ConversationMessage[]): string {
  const lastLine = history.findLast((m) => !m.automated);
  const lastContactLine = lastLine?.from === 'them' ? lastLine : undefined;
  return lastContactLine?.removedAs
    ? `\n(The contact's previous message was removed by moderation as ${lastContactLine.removedAs}. Judge whether this message continues it.)`
    : '';
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

  const userSpoke = userHasSpoken(history);

  try {
    const response = await ollama.chat({
      model,
      messages: [
        { role: 'system', content: buildSystemPrompt(policy, contactContext, userSpoke) },
        {
          role: 'user',
          content: `# Recent conversation\n${formatHistory(history)}\n\n# Newest message to classify\nContact: ${message}${followUpNote(history)}`,
        },
      ],
      format: responseSchema(userSpoke),
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
