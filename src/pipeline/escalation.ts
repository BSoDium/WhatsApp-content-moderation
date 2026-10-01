import { createLogger } from '../cli/logger.ts';
import { createBlock, getActiveBlock } from '../store/blocks.ts';
import type { BlockOutlook } from '../classifier/warning-consequence.ts';
import { isEscalationEnabled } from '../store/monitored-contacts.ts';
import { emitControlEvent } from '../store/events.ts';
import { getNumberSetting } from '../store/settings.ts';
import { baseBlockDurationMs } from './block-duration.ts';

const logger = createLogger('pipeline');

// Largest share of the block duration jitter may swing, so a 3h first block with the default 4h jitter can't roll a near-zero block.
const MAX_JITTER_SHARE = 0.25;

// Floor under BLOCK_DURATION_MS +/- jitter, so a misconfigured BLOCK_JITTER_MS can't roll a zero/negative block length.
const MIN_BLOCK_MS = 60 * 1000;

// Symmetric jitter in [-ms, +ms] — see docs/decisions.md "Trigger, duration, and jitter (issue #8 design)".
function jitter(ms: number): number {
  return Math.round((Math.random() * 2 - 1) * ms);
}

// moderation-pipeline.ts and call-pipeline.ts each serialize their own event processing per contact in two separate Maps, so without a lock here too, one message burst and one call event for the same contact could both pass this function's getActiveBlock check before either writes, producing two block rows.
const contactLocks = new Map<string, Promise<unknown>>();

function withContactLock<T>(contactId: string, run: () => Promise<T>): Promise<T> {
  const prior = contactLocks.get(contactId) ?? Promise.resolve();
  const next = prior.then(run, run);
  contactLocks.set(
    contactId,
    next.catch(() => {}),
  );
  return next;
}

/**
 * What a warning sent at this strike count may truthfully say about
 * blocking, mirroring maybeBlockContact's decision before it is applied.
 */
export function blockOutlook(contactId: string, strikeCount: number, strikeThreshold: number): BlockOutlook {
  if (!isEscalationEnabled(contactId)) return 'never';
  return strikeCount >= strikeThreshold && !getActiveBlock(contactId) ? 'blocking' : 'countdown';
}

/**
 * Blocks contactId once strikeCount crosses strikeThreshold, unless they
 * already have an active block. Shared by moderation-pipeline.ts (message
 * strikes) and call-pipeline.ts (nuisance-call strikes) — each has its own
 * independent counter/threshold, but both must reach a block the exact same
 * way: the block duration (fixed or escalating, see block-duration.ts) and BLOCK_JITTER_MS, the escalation_enabled per-contact
 * opt-out, and — critically — block() (the external call) succeeding
 * *before* createBlock (the local record) ever runs, so a failed WhatsApp
 * call never gets recorded as an active block. See docs/decisions.md
 * "Trigger, duration, and jitter (issue #8 design)" for why that ordering
 * is load-bearing, not incidental.
 *
 * @returns {Promise<boolean>} whether contactId ends this call blocked, so
 *   a caller iterating several events in one pass can skip the
 *   getActiveBlock read once a block's already succeeded.
 */
export async function maybeBlockContact(
  contactId: string,
  strikeCount: number,
  strikeThreshold: number,
  block: (contactId: string) => Promise<unknown>,
): Promise<boolean> {
  return withContactLock(contactId, () => runMaybeBlockContact(contactId, strikeCount, strikeThreshold, block));
}

async function runMaybeBlockContact(
  contactId: string,
  strikeCount: number,
  strikeThreshold: number,
  block: (contactId: string) => Promise<unknown>,
): Promise<boolean> {
  if (strikeCount < strikeThreshold) return false;
  if (getActiveBlock(contactId)) return true;

  if (!isEscalationEnabled(contactId)) {
    logger.info({ contactId, strikeCount }, 'strike threshold crossed but escalation is disabled for this contact; skipping block');
    return false;
  }

  const blockDurationMs = baseBlockDurationMs(contactId);
  const blockJitterMs = getNumberSetting('BLOCK_JITTER_MS');
  const unblockAt = Date.now() + Math.max(blockDurationMs + jitter(Math.min(blockJitterMs, blockDurationMs * MAX_JITTER_SHARE)), MIN_BLOCK_MS);
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
