import { createLogger } from '../cli/logger.ts';
import { classifyMessage } from '../classifier/classifier.ts';
import type { ConversationMessage } from '../classifier/classifier.ts';
import { generateWarningMessage } from '../classifier/warning-message.ts';
import type { WarningReason } from '../classifier/warning-message.ts';
import { getStrikeCount, recordStrike } from '../store/strikes.ts';
import { logMessage, getAuditLog, getLastActionAt, setLoggedAction } from '../store/audit-log.ts';
import { getMonitored } from '../store/monitored-contacts.ts';
import { getRawSetting, getNumberSetting, getBoolSetting } from '../store/settings.ts';
import { maybeBlockContact, blockOutlook } from './escalation.ts';
import type { WAMessageKey } from '@whiskeysockets/baileys';
import type { Classification, IncomingMessage } from '../types.ts';

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

const logger = createLogger('pipeline');

const WARNING_SENT_ACTION = 'warning_sent';
const REMOVED_ACTIONS = ['delete+warn', 'delete'];
const LANGUAGE_SAMPLE_MESSAGES = 3;
const MAX_DETAIL_ERROR_LENGTH = 120;

interface Incident {
  texts: string[];
  reasons: WarningReason[];
  openerRowId: number;
}

function loadHistory(contactId: string): ConversationMessage[] {
  return getAuditLog(contactId, getNumberSetting('CLASSIFIER_HISTORY_LIMIT'))
    .reverse()
    .map((row) => ({
      from: row.direction === 'me' ? 'me' : 'them',
      text: row.message,
      automated: row.action === WARNING_SENT_ACTION,
      removedAs: REMOVED_ACTIONS.includes(row.action) ? (row.category ?? 'violation') : undefined,
    }));
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
 * + a strike for a flagged message. Prior audit-log entries seed
 * classifyMessage's history, and earlier messages in this same burst are
 * folded in as they're processed, so a burst is judged as a conversation
 * rather than message-by-message in isolation (see docs/roadmap.md issue #6). The warning reply text itself comes from
 * generateWarningMessage — contextual to the actual violation, not a fixed
 * string — with FALLBACK_WARNING_MESSAGE used verbatim if that generation
 * fails open; either way a warning is always sent alongside the delete.
 *
 * A burst is one incident: every flagged message is deleted straight away, but
 * only the first earns a strike, and a single warning describing all of them
 * goes out once the burst has been classified. Flagged messages arriving
 * within STRIKE_COOLDOWN_MS of the last warning are logged as 'delete' with no
 * new strike or warning. Strikes decay with time, not with clean
 * messages (see src/store/strikes.ts).
 *
 * Fails open per classifyMessage's { ok: false } contract: an
 * unclassifiable message is logged and left alone, never deleted, warned,
 * or struck. The same applies if deleteForMe/sendWarning themselves throw
 * (a real possibility — see AGENTS.md's "Error handling"): the failure is
 * logged and the message is left unstruck rather than recording a strike
 * for an action that didn't actually complete.
 *
 * Shadow mode (the SHADOW_MODE setting, on by default) classifies and audit-logs every message but
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

async function runBurst(
  { contactId, messages }: Burst,
  { deleteForMe, sendWarning, block, classify = classifyMessage, generateWarning = generateWarningMessage, isPaused = () => false }: BurstActions,
): Promise<{ strikeCount: number }> {
  const history = loadHistory(contactId);
  let strikeCount = getStrikeCount(contactId);
  // Read once per burst, not once per message — a contact's context can't
  // change mid-burst since edits go through the roster, not this loop.
  const contactContext = getMonitored(contactId)?.context ?? undefined;
  // Same reasoning: read once so the warning text ("N strikes remain") and
  // the actual block decision below always agree, even if this setting is
  // edited mid-burst.
  const strikeThreshold = getNumberSetting('STRIKE_THRESHOLD');
  // One violation drip-fed across several messages is one incident: once a strike has been recorded and the contact warned (in this burst or within STRIKE_COOLDOWN_MS of the last warning), further flagged messages are only deleted.
  let incidentOpen = isWithinStrikeCooldown(contactId);
  let incident: Incident | null = null;

  for (const { text, key, timestamp } of messages) {
    if (isPaused(contactId)) {
      logger.info({ contactId }, 'moderation paused; message left unclassified and unactioned');
      continue;
    }

    // Stamped with the message's own time, not the time classification finished, so a slow classifier can't file it after a reply the user sent in the meantime.
    const logIncoming = (classification: Classification, action: string): number =>
      logMessage({ contactId, direction: 'them', message: text, classification, action, createdAt: timestamp });

    const classification = await classify({ message: text, history, contactContext });
    history.push({ from: 'them', text, removedAs: classification.ok && classification.flagged && !getBoolSetting('SHADOW_MODE') ? classification.category : undefined });

    if (!classification.ok) {
      logger.warn({ contactId, error: classification.error }, 'classification failed; fail-open, no action taken');
      logIncoming(classification, 'classifier_error');
      continue;
    }

    if (getBoolSetting('SHADOW_MODE')) {
      logIncoming(classification, 'shadow');
      continue;
    }

    if (!classification.flagged) {
      logIncoming(classification, 'none');
      continue;
    }

    try {
      await deleteForMe(contactId, key, timestamp);
    } catch (err) {
      logger.error({ contactId, deleteError: String(err) }, 'deleteForMe failed');
      logIncoming(classification, 'delete_failed');
      continue;
    }

    if (incident) {
      incident.texts.push(text);
      incident.reasons.push({ category: classification.category, reason: classification.reason });
    }
    if (incidentOpen) {
      logIncoming(classification, 'delete');
      continue;
    }

    incidentOpen = true;
    incident = {
      texts: [text],
      reasons: [{ category: classification.category, reason: classification.reason }],
      openerRowId: logIncoming(classification, 'delete'),
    };
  }

  if (incident) {
    const warning = await warnAboutIncident(contactId, incident, strikeCount + 1, strikeThreshold, { sendWarning, generateWarning });
    if (warning === null) {
      setLoggedAction(incident.openerRowId, 'warn_failed');
    } else {
      strikeCount = recordStrike(contactId);
      setLoggedAction(incident.openerRowId, 'delete+warn');
      logMessage({
        contactId,
        direction: 'me',
        message: warning.text,
        classification: { ok: true, flagged: false, category: 'warning', reason: `automated warning sent (${warning.detail})` },
        action: WARNING_SENT_ACTION,
      });
      await maybeBlockContact(contactId, strikeCount, strikeThreshold, block);
    }
  }

  return { strikeCount };
}

// Returns the text that went out, or null when the contact was never told; the fallback is used only when generation fails open, because the contact still has to learn their messages were removed.
async function warnAboutIncident(
  contactId: string,
  { texts, reasons }: Incident,
  strikeCount: number,
  strikeThreshold: number,
  { sendWarning, generateWarning }: Pick<Required<BurstActions>, 'sendWarning' | 'generateWarning'>,
): Promise<{ text: string; detail: string } | null> {
  const warningResult = await generateWarning({
    message: texts.slice(0, LANGUAGE_SAMPLE_MESSAGES).join('\n'),
    deletedCount: texts.length,
    reasons,
    strikeCount,
    strikeThreshold,
    blockOutlook: blockOutlook(contactId, strikeCount, strikeThreshold),
  });
  if (!warningResult.ok) {
    logger.warn({ contactId, error: warningResult.error }, 'warning message generation failed open; falling back to the static message');
  }
  const warningText = warningResult.ok ? warningResult.text : getRawSetting('WARNING_MESSAGE');
  const detail = warningResult.ok ? (warningResult.detail ?? 'sent') : `fallback message; ${warningResult.error.slice(0, MAX_DETAIL_ERROR_LENGTH)}`;

  try {
    await sendWarning(contactId, warningText);
  } catch (err) {
    logger.error({ contactId, warnError: String(err) }, 'sendWarning failed');
    return null;
  }
  return { text: warningText, detail };
}

function isWithinStrikeCooldown(contactId: string): boolean {
  const cooldownMs = getNumberSetting('STRIKE_COOLDOWN_MS');
  const lastWarnedAt = getLastActionAt(contactId, WARNING_SENT_ACTION);
  return lastWarnedAt !== null && Date.now() - lastWarnedAt < cooldownMs;
}
