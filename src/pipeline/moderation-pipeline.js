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
 * or struck.
 *
 * Shadow mode (SHADOW_MODE=1) classifies and audit-logs every message but
 * skips delete/warn/strike entirely, for watching classifier behavior on
 * real traffic before trusting it to act — see docs/roadmap.md issue #7.
 *
 * Blocking after repeated strikes is out of scope here — see issue #8;
 * this only reports the resulting strike count.
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
export async function handleBurst({ contactId, messages }, { deleteForMe, sendWarning, classify = classifyMessage }) {
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

    await deleteForMe(contactId, key, timestamp);
    await sendWarning(contactId, WARNING_MESSAGE);
    strikeCount = recordStrike(contactId);
    logMessage({ contactId, direction: 'them', message: text, classification, action: 'delete+warn' });
  }

  return { strikeCount };
}
