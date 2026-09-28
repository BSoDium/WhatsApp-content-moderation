import { createLogger } from '../cli/logger.ts';
import { createBlock, getActiveBlock } from '../store/blocks.ts';
import { isEscalationEnabled } from '../store/monitored-contacts.ts';
import { emitControlEvent } from '../store/events.ts';
import { getNumberSetting } from '../store/settings.ts';

const logger = createLogger('pipeline');

// Floor under BLOCK_DURATION_MS +/- jitter, so a misconfigured BLOCK_JITTER_MS can't roll a zero/negative block length.
const MIN_BLOCK_MS = 60 * 1000;

// Symmetric jitter in [-ms, +ms] — see docs/decisions.md "Trigger, duration, and jitter (issue #8 design)".
function jitter(ms: number): number {
  return Math.round((Math.random() * 2 - 1) * ms);
}

/**
 * Blocks contactId once strikeCount crosses strikeThreshold, unless they
 * already have an active block. Shared by moderation-pipeline.ts (message
 * strikes) and call-pipeline.ts (nuisance-call strikes) — each has its own
 * independent counter/threshold, but both must reach a block the exact same
 * way: BLOCK_DURATION_MS/BLOCK_JITTER_MS, the escalation_enabled per-contact
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
