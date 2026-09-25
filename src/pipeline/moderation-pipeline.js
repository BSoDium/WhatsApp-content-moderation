import pino from 'pino';
import { classifyMessage } from '../classifier/classifier.js';
import { getStrikeCount, recordStrike, decayStrike } from '../store/strikes.js';
import { logMessage, getAuditLog } from '../store/audit-log.js';
import { createBlock, getActiveBlock } from '../store/blocks.js';

const SHADOW_MODE = process.env.SHADOW_MODE === '1';
const HISTORY_LIMIT = Number(process.env.CLASSIFIER_HISTORY_LIMIT ?? 10);
const WARNING_MESSAGE =
  process.env.WARNING_MESSAGE ?? "That message was removed for violating this chat's policy.";
// See docs/decisions.md "Trigger, duration, and jitter (issue #8 design)".
const STRIKE_THRESHOLD = Number(process.env.STRIKE_THRESHOLD ?? 3);
const BLOCK_DURATION_MS = Number(process.env.BLOCK_DURATION_MS ?? 24 * 60 * 60 * 1000);
const BLOCK_JITTER_MS = Number(process.env.BLOCK_JITTER_MS ?? 4 * 60 * 60 * 1000);
// Floor under BLOCK_DURATION_MS +/- jitter, so a misconfigured BLOCK_JITTER_MS can't roll a zero/negative block length.
const MIN_BLOCK_MS = 60 * 1000;

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
 * skips delete/warn/strike/block entirely, for watching classifier behavior
 * on real traffic before trusting it to act — see docs/roadmap.md issue #7.
 *
 * A strike count reaching STRIKE_THRESHOLD triggers a block, unless the
 * contact already has one active — see docs/decisions.md "Trigger,
 * duration, and jitter (issue #8 design)". Unblocking is handled
 * separately by src/pipeline/unblock-scheduler.js, not here.
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
 *   block: (contactId: string) => Promise<void>,
 *   classify?: typeof classifyMessage,
 * }} actions
 * @returns {Promise<{ strikeCount: number }>}
 */
export async function handleBurst(burst, actions) {
  return serialize(burst.contactId, () => runBurst(burst, actions));
}

/**
 * The in-flight handleBurst promise for every contact currently mid-burst,
 * for a caller (index.js's shutdown()) to await before exiting so a burst
 * that's already classifying/acting doesn't get silently abandoned.
 *
 * @returns {Promise<unknown>[]}
 */
export function pendingBursts() {
  return Array.from(contactQueues.values());
}

// Symmetric jitter in [-ms, +ms], applied once at block time — see docs/decisions.md "Trigger, duration, and jitter (issue #8 design)".
function jitter(ms) {
  return Math.round((Math.random() * 2 - 1) * ms);
}

/**
 * Blocks contactId once strikeCount crosses STRIKE_THRESHOLD, unless they
 * already have an active block. Logs two distinct failure modes: block()
 * (the external call) throwing means nothing happened and the next flagged
 * message will retry cleanly, but block() succeeding and createBlock (the
 * local record) then throwing leaves the contact actually blocked with no
 * row for unblock-scheduler.js to ever find — that needs a searchable log
 * line of its own, not a generic "block failed" that reads as a no-op.
 *
 * @returns {Promise<boolean>} whether contactId ends this call blocked, so
 *   a caller iterating several messages in one burst can skip the
 *   getActiveBlock read once a block's already succeeded this burst.
 */
async function maybeBlockContact(contactId, strikeCount, block) {
  if (strikeCount < STRIKE_THRESHOLD) return false;
  if (getActiveBlock(contactId)) return true;

  const unblockAt = Date.now() + Math.max(BLOCK_DURATION_MS + jitter(Math.min(BLOCK_JITTER_MS, BLOCK_DURATION_MS)), MIN_BLOCK_MS);
  let blockedOnWhatsApp = false;
  try {
    await block(contactId);
    blockedOnWhatsApp = true;
    createBlock(contactId, unblockAt);
    logger.info({ contactId, strikeCount, unblockAt }, 'contact blocked');
    return true;
  } catch (err) {
    const message = blockedOnWhatsApp
      ? 'contact was blocked on WhatsApp but the local block record failed to save — will not auto-unblock, needs manual intervention'
      : 'block failed';
    logger.error({ contactId, error: err?.message ?? String(err) }, message);
    return false;
  }
}

async function runBurst({ contactId, messages }, { deleteForMe, sendWarning, block, classify = classifyMessage }) {
  const history = loadHistory(contactId);
  let strikeCount = getStrikeCount(contactId);
  let isBlocked = false;

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

    if (!isBlocked) {
      isBlocked = await maybeBlockContact(contactId, strikeCount, block);
    }
  }

  return { strikeCount };
}
