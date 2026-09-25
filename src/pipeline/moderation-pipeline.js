import pino from 'pino';
import { classifyMessage } from '../classifier/classifier.js';
import { getStrikeCount, recordStrike, decayStrike } from '../store/strikes.js';
import { logMessage, getAuditLog } from '../store/audit-log.js';

const SHADOW_MODE = process.env.SHADOW_MODE === '1';
const HISTORY_LIMIT = Number(process.env.CLASSIFIER_HISTORY_LIMIT ?? 10);
const WARNING_MESSAGE =
  process.env.WARNING_MESSAGE ?? "That message was removed for violating this chat's policy.";

const logger = pino({ name: 'pipeline' });

function loadHistory(contactId) {
  return getAuditLog(contactId, HISTORY_LIMIT)
    .reverse()
    .map((row) => ({ from: row.direction === 'me' ? 'me' : 'them', text: row.message }));
}

// Per-contact promise chain so two bursts for the same contact never run
// handleBurst concurrently. Without this, createMessageBuffer (which frees
// a contact's slot before calling onFlush — see src/buffer/message-buffer.js)
// would let a slow classify/deleteForMe/sendWarning round-trip overlap with
// the next burst's handleBurst, interleaving reads/writes to the strikes and
// audit_log tables.
const contactQueues = new Map();

function serialize(contactId, run) {
  const prior = contactQueues.get(contactId) ?? Promise.resolve();
  const next = prior.then(run, run);
  contactQueues.set(
    contactId,
    next.catch(() => {}),
  );
  return next;
}

/**
 * Runs one flushed burst of messages from a contact (src/buffer/) through
 * the classifier and acts on each verdict: delete-for-me + a warning reply
 * + a strike for a flagged message, a strike decay for a passed one. Prior
 * audit-log entries seed classifyMessage's history, and earlier messages in
 * this same burst are folded in as they're processed, so a burst is judged
 * as a conversation rather than message-by-message in isolation (see
 * docs/roadmap.md issue #6).
 *
 * Fails open per classifyMessage's { ok: false } contract: an
 * unclassifiable message is logged and left alone, never deleted, warned,
 * or struck. The same applies if deleteForMe/sendWarning themselves throw
 * (a real possibility — see AGENTS.md's "Error handling"): the failure is
 * logged and the message is left unstruck rather than recording a strike
 * for an action that didn't actually complete.
 *
 * Shadow mode (SHADOW_MODE=1) classifies and audit-logs every message but
 * skips delete/warn/strike entirely, for watching classifier behavior on
 * real traffic before trusting it to act — see docs/roadmap.md issue #7.
 *
 * Blocking after repeated strikes is out of scope here — see issue #8;
 * this only reports the resulting strike count.
 *
 * Bursts for the same contactId are serialized (see `serialize` above), so
 * this is safe to call concurrently from the buffer's per-contact flushes.
 *
 * @param {{
 *   contactId: string,
 *   messages: { text: string, key: object, timestamp: number }[],
 * }} burst
 * @param {{
 *   deleteForMe: (contactId: string, key: object, timestamp: number) => Promise<void>,
 *   sendWarning: (contactId: string, text: string) => Promise<void>,
 *   classify?: typeof classifyMessage,
 * }} actions
 * @returns {Promise<{ strikeCount: number }>}
 */
export async function handleBurst(burst, actions) {
  return serialize(burst.contactId, () => runBurst(burst, actions));
}

async function runBurst({ contactId, messages }, { deleteForMe, sendWarning, classify = classifyMessage }) {
  const history = loadHistory(contactId);
  let strikeCount = getStrikeCount(contactId);

  for (const { text, key, timestamp } of messages) {
    const classification = await classify({ message: text, history });
    history.push({ from: 'them', text });

    if (!classification.ok) {
      logger.warn({ contactId, error: classification.error }, 'classification failed; fail-open, no action taken');
      logMessage({ contactId, direction: 'them', message: text, classification, action: 'classifier_error' });
      continue;
    }

    if (SHADOW_MODE) {
      logMessage({ contactId, direction: 'them', message: text, classification, action: 'shadow' });
      continue;
    }

    if (!classification.flagged) {
      strikeCount = decayStrike(contactId);
      logMessage({ contactId, direction: 'them', message: text, classification, action: 'none' });
      continue;
    }

    try {
      await Promise.all([deleteForMe(contactId, key, timestamp), sendWarning(contactId, WARNING_MESSAGE)]);
    } catch (err) {
      logger.error({ contactId, error: err?.message ?? String(err) }, 'deleteForMe/sendWarning failed');
      logMessage({ contactId, direction: 'them', message: text, classification, action: 'action_failed' });
      continue;
    }

    strikeCount = recordStrike(contactId);
    logMessage({ contactId, direction: 'them', message: text, classification, action: 'delete+warn' });
  }

  return { strikeCount };
}
