import { createLogger } from '../cli/logger.ts';
import { generateCallWarningMessage } from '../classifier/call-warning-message.ts';
import { getAuditLog, logMessage } from '../store/audit-log.ts';
import { getCallState, recordUnansweredCall, recordCallStrike, recordAnsweredCall } from '../store/call-strikes.ts';
import { getEffectiveNuisanceThreshold } from '../store/monitored-contacts.ts';
import { getRawSetting, getNumberSetting, getBoolSetting } from '../store/settings.ts';
import { maybeBlockContact } from './escalation.ts';
import type { WACallEvent } from '@whiskeysockets/baileys';

interface CallEvent {
  contactId: string;
  call: WACallEvent;
}

interface CallActions {
  rejectCall: (callId: string, callFrom: string) => Promise<unknown>;
  sendWarning: (contactId: string, text: string) => Promise<unknown>;
  block: (contactId: string) => Promise<unknown>;
  generateWarning?: typeof generateCallWarningMessage;
}

const RECENT_MESSAGE_LIMIT = 5;
const AUDIT_LOOKBACK = 40;
const CALL_CATEGORY = 'call';

const logger = createLogger('pipeline');

// Per-contact promise chain, same reasoning as moderation-pipeline.ts's serialize(): two call events for the same contact (e.g. a rapid re-call) must never read-then-write getCallState/recordX concurrently.
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
 * Every call.id this app itself rejected via rejectCall, so the 'reject'
 * event that action triggers isn't double-counted as an unanswered call on
 * top of the strike already recorded at 'offer' time. Deliberately
 * in-memory only, not persisted: a call resolves (reject/timeout/accept)
 * within seconds, so an entry's lifetime is always short — the only way one
 * leaks is a call whose resolution event never arrives at all, in which case
 * a handful of bytes sitting in memory is harmless.
 */
const rejectedCallIds = new Set<string>();

export async function handleCallEvent(event: CallEvent, actions: CallActions): Promise<void> {
  return serialize(event.contactId, () => runCallEvent(event, actions));
}

/**
 * The in-flight handleCallEvent promise for every contact currently
 * mid-event, for index.ts's shutdown() to await — same reasoning as
 * moderation-pipeline.ts's pendingBursts().
 */
export function pendingCallEvents(): Promise<unknown>[] {
  return [...contactQueues.values()];
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function logCallEvent(contactId: string, call: WACallEvent, action: string, flagged: boolean = action === 'call_nuisance_warned'): void {
  logMessage({
    contactId,
    direction: 'them',
    message: `[${call.isVideo ? 'video' : 'voice'} call]`,
    classification: { ok: true, flagged, category: 'call', reason: call.status },
    action,
  });
}

function renderWarningMessage(strikeCount: number, strikeThreshold: number): string {
  return getRawSetting('NUISANCE_CALL_WARNING_MESSAGE')
    .replaceAll('{strikes}', String(strikeCount))
    .replaceAll('{threshold}', String(strikeThreshold));
}

function shadowModeSkip(contactId: string, call: WACallEvent): boolean {
  if (!getBoolSetting('SHADOW_MODE')) return false;
  logCallEvent(contactId, call, 'call_shadow');
  return true;
}

function recentIncomingMessages(contactId: string): string[] {
  return getAuditLog(contactId, AUDIT_LOOKBACK)
    .filter((entry) => entry.direction === 'them' && entry.category !== CALL_CATEGORY)
    .slice(0, RECENT_MESSAGE_LIMIT)
    .reverse()
    .map((entry) => entry.message);
}

async function resolveWarningText(contactId: string, strikeCount: number, strikeThreshold: number, actions: CallActions): Promise<string> {
  const fallback = renderWarningMessage(strikeCount, strikeThreshold);
  const recentMessages = recentIncomingMessages(contactId);
  if (recentMessages.length === 0) return fallback;

  const generate = actions.generateWarning ?? generateCallWarningMessage;
  const result = await generate({ recentMessages, strikeCount, strikeThreshold });
  if (result.ok) return result.text;

  logger.warn({ contactId, error: result.error }, 'call warning generation failed; using the static fallback');
  return fallback;
}

async function handleOffer(contactId: string, call: WACallEvent, actions: CallActions): Promise<void> {
  const { unansweredCount, strikeCount } = getCallState(contactId);
  const threshold = getEffectiveNuisanceThreshold(contactId);
  const isNuisance = unansweredCount >= threshold;

  if (getBoolSetting('SHADOW_MODE')) {
    logCallEvent(contactId, call, 'call_shadow', isNuisance);
    return;
  }

  if (!isNuisance) {
    logCallEvent(contactId, call, 'call_received');
    return;
  }

  const strikeThreshold = getNumberSetting('NUISANCE_CALL_STRIKE_THRESHOLD');
  const autoReject = getBoolSetting('NUISANCE_CALL_AUTO_REJECT');

  // rejectCall and sendWarning are independent of each other's outcome, run concurrently — mirrors moderation-pipeline.ts's delete+warn Promise.allSettled pair.
  const [rejectOutcome, warnOutcome] = await Promise.allSettled([
    autoReject ? actions.rejectCall(call.id, call.from) : Promise.resolve(undefined),
    resolveWarningText(contactId, strikeCount + 1, strikeThreshold, actions).then((text) => actions.sendWarning(contactId, text)),
  ]);

  if (autoReject) {
    if (rejectOutcome.status === 'fulfilled') {
      // Only mark as "ours" once the reject actually succeeded, so a failed attempt never swallows the real 'reject' event that follows it.
      rejectedCallIds.add(call.id);
    } else {
      logger.warn({ contactId, callId: call.id, error: errorMessage(rejectOutcome.reason) }, 'rejectCall failed; falling back to warning only');
      logCallEvent(contactId, call, 'call_reject_failed');
    }
  }

  if (warnOutcome.status === 'rejected') {
    logger.error({ contactId, error: errorMessage(warnOutcome.reason) }, 'sendWarning failed for nuisance call');
    logCallEvent(contactId, call, 'call_warn_failed');
    return;
  }

  const newStrikeCount = recordCallStrike(contactId);
  logCallEvent(contactId, call, 'call_nuisance_warned');
  await maybeBlockContact(contactId, newStrikeCount, strikeThreshold, actions.block);
}

async function runCallEvent({ contactId, call }: CallEvent, actions: CallActions): Promise<void> {
  switch (call.status) {
    case 'offer':
      return handleOffer(contactId, call, actions);
    case 'timeout':
      // Never one we rejected ourselves — a call we reject resolves as 'reject', not 'timeout'.
      if (shadowModeSkip(contactId, call)) return;
      recordUnansweredCall(contactId);
      logCallEvent(contactId, call, 'call_unanswered');
      return;
    case 'reject':
      if (rejectedCallIds.delete(call.id)) return; // echo of our own rejectCall — already counted at offer time
      if (shadowModeSkip(contactId, call)) return; // declined manually on the phone instead
      recordUnansweredCall(contactId);
      logCallEvent(contactId, call, 'call_unanswered');
      return;
    case 'accept':
      rejectedCallIds.delete(call.id); // race cleanup — answered before our reject landed
      if (shadowModeSkip(contactId, call)) return;
      recordAnsweredCall(contactId);
      logCallEvent(contactId, call, 'call_answered');
      return;
    default:
      // 'ringing'/'preaccept'/'transport'/'relaylatency'/'terminate' — not signal-bearing for nuisance detection.
      return;
  }
}
