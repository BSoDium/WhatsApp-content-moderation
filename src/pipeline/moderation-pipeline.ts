import pino from 'pino';
import { classifyMessage } from '../classifier/classifier.ts';
import { generateWarningMessage } from '../classifier/warning-message.ts';
import { getStrikeCount, recordStrike, decayStrike } from '../store/strikes.ts';
import { logMessage, getAuditLog } from '../store/audit-log.ts';
import { createBlock, getActiveBlock } from '../store/blocks.ts';
import { isEscalationEnabled, getMonitored } from '../store/monitored-contacts.ts';
import { emitControlEvent } from '../store/events.ts';
import { getRawSetting, getNumberSetting } from '../store/settings.ts';
import type { WAMessageKey } from '@whiskeysockets/baileys';
import type { IncomingMessage } from '../types.ts';

interface Burst {
  contactId: string;
  messages: IncomingMessage[];
}

interface BurstActions {
  deleteForMe: (contactId: string, key: WAMessageKey, timestamp: number) => Promise<unknown>;
  sendWarning: (contactId: string, text: string) => Promise<unknown>;
  block: (contactId: string) => Promise<unknown>;
  classify?: typeof classifyMessage;
  generateWarning?: typeof generateWarningMessage;
  // Re-checked before acting on every message, not just once when the
  // message was first buffered (index.ts) — a burst can sit buffered for
  // several seconds, long enough for an operator's 'pause' override to land
  // mid-burst. Defaults to "never paused" so existing callers/tests that
  // don't pass it are unaffected.
  isPaused?: (contactId: string) => boolean;
}

type ConversationMessage = { from: 'me' | 'them'; text: string };

const SHADOW_MODE = process.env.SHADOW_MODE === '1';
// Floor under BLOCK_DURATION_MS +/- jitter, so a misconfigured BLOCK_JITTER_MS can't roll a zero/negative block length.
const MIN_BLOCK_MS = 60 * 1000;

const logger = pino({ name: 'pipeline' });

function loadHistory(contactId: string): ConversationMessage[] {
  return getAuditLog(contactId, getNumberSetting('CLASSIFIER_HISTORY_LIMIT'))
    .reverse()
    .map((row) => ({ from: row.direction === 'me' ? 'me' : 'them', text: row.message }));
}

// Per-contact promise chain so two bursts for the same contact never run handleBurst concurrently (see handleBurst's own JSDoc below).
const contactQueues = new Map<string, Promise<unknown>>();

function serialize<T>(contactId: string, run: () => Promise<T>): Promise<T> {
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
 * docs/roadmap.md issue #6). The warning reply text itself comes from
 * generateWarningMessage — contextual to the actual violation, not a fixed
 * string — with FALLBACK_WARNING_MESSAGE used verbatim if that generation
 * fails open; either way a warning is always sent alongside the delete.
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
 * contact already has one active or has escalation disabled on the
 * monitored-contacts roster (strikes/delete/warn/audit-log still happen
 * either way — only the block step is gated) — see docs/decisions.md
 * "Trigger, duration, and jitter (issue #8 design)". Unblocking is handled
 * separately by src/pipeline/unblock-scheduler.ts, not here.
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
 *   generateWarning?: typeof generateWarningMessage,
 * }} actions
 * @returns {Promise<{ strikeCount: number }>}
 */
export async function handleBurst(burst: Burst, actions: BurstActions): Promise<{ strikeCount: number }> {
  return serialize(burst.contactId, () => runBurst(burst, actions));
}

/**
 * The in-flight handleBurst promise for every contact currently mid-burst,
 * for a caller (index.ts's shutdown()) to await before exiting so a burst
 * that's already classifying/acting doesn't get silently abandoned.
 *
 * @returns {Promise<unknown>[]}
 */
export function pendingBursts(): Promise<unknown>[] {
  return [...contactQueues.values()];
}

// Symmetric jitter in [-ms, +ms], applied once at block time — see docs/decisions.md "Trigger, duration, and jitter (issue #8 design)".
function jitter(ms: number): number {
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
async function maybeBlockContact(contactId: string, strikeCount: number, strikeThreshold: number, block: BurstActions['block']): Promise<boolean> {
  if (strikeCount < strikeThreshold) return false;
  if (getActiveBlock(contactId)) return true;

  if (!isEscalationEnabled(contactId)) {
    logger.info({ contactId, strikeCount }, 'strike threshold crossed but escalation is disabled for this contact; skipping block');
    return false;
  }

  const blockDurationMs = getNumberSetting('BLOCK_DURATION_MS');
  const blockJitterMs = getNumberSetting('BLOCK_JITTER_MS');
  const unblockAt = Date.now() + Math.max(blockDurationMs + jitter(Math.min(blockJitterMs, blockDurationMs)), MIN_BLOCK_MS);
  let blockedOnWhatsApp = false;
  try {
    await block(contactId);
    blockedOnWhatsApp = true;
    createBlock(contactId, unblockAt);
    emitControlEvent('roster');
    logger.info({ contactId, strikeCount, unblockAt }, 'contact blocked');
    return true;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const message = blockedOnWhatsApp
      ? 'contact was blocked on WhatsApp but the local block record failed to save — will not auto-unblock, needs manual intervention'
      : 'block failed';
    logger.error({ contactId, error }, message);
    return false;
  }
}

async function runBurst(
  { contactId, messages }: Burst,
  { deleteForMe, sendWarning, block, classify = classifyMessage, generateWarning = generateWarningMessage, isPaused = () => false }: BurstActions,
): Promise<{ strikeCount: number }> {
  const history = loadHistory(contactId);
  let strikeCount = getStrikeCount(contactId);
  let isBlocked = false;
  // Read once per burst, not once per message — a contact's context can't
  // change mid-burst since edits go through the roster, not this loop.
  const contactContext = getMonitored(contactId)?.context ?? undefined;
  // Same reasoning: read once so the warning text ("N strikes remain") and
  // the actual block decision below always agree, even if this setting is
  // edited mid-burst.
  const strikeThreshold = getNumberSetting('STRIKE_THRESHOLD');

  for (const { text, key, timestamp } of messages) {
    if (isPaused(contactId)) {
      logger.info({ contactId }, 'moderation paused; message left unclassified and unactioned');
      continue;
    }

    const classification = await classify({ message: text, history, contactContext });
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

    const warningResult = await generateWarning({
      message: text,
      category: classification.category,
      reason: classification.reason,
      strikeCount: strikeCount + 1,
      strikeThreshold,
    });
    if (!warningResult.ok) {
      logger.warn({ contactId, error: warningResult.error }, 'warning message generation failed open; falling back to the static message');
    }
    // Used only when generateWarningMessage fails open (see its own JSDoc) — the
    // contact still needs to be told their message was removed even when the LLM
    // call itself couldn't produce a contextual one.
    const warningText = warningResult.ok ? warningResult.text : getRawSetting('WARNING_MESSAGE');

    const [deleteOutcome, warnOutcome] = await Promise.allSettled([
      deleteForMe(contactId, key, timestamp),
      sendWarning(contactId, warningText),
    ]);
    if (deleteOutcome.status === 'rejected' || warnOutcome.status === 'rejected') {
      // allSettled (not all) so one call's rejection never hides whether the
      // other one actually went through — the two log distinctly ('the
      // message was never deleted' vs. 'deleted, but the contact was never
      // told') instead of a single ambiguous 'action_failed' either way.
      logger.error(
        {
          contactId,
          deleteError: deleteOutcome.status === 'rejected' ? String(deleteOutcome.reason) : undefined,
          warnError: warnOutcome.status === 'rejected' ? String(warnOutcome.reason) : undefined,
        },
        'deleteForMe/sendWarning failed',
      );
      logMessage({
        contactId,
        direction: 'them',
        message: text,
        classification,
        action: deleteOutcome.status === 'rejected' ? 'delete_failed' : 'warn_failed',
      });
      continue;
    }

    strikeCount = recordStrike(contactId);
    logMessage({ contactId, direction: 'them', message: text, classification, action: 'delete+warn' });
    logMessage({
      contactId,
      direction: 'me',
      message: warningText,
      classification: { ok: true, flagged: false, category: 'warning', reason: 'automated warning sent' },
      action: 'warning_sent',
    });
    history.push({ from: 'me', text: warningText });

    if (!isBlocked) {
      isBlocked = await maybeBlockContact(contactId, strikeCount, strikeThreshold, block);
    }
  }

  return { strikeCount };
}
