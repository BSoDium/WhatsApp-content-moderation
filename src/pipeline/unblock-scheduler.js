import pino from 'pino';
import { getExpiredBlocks, markUnblocked } from '../store/blocks.js';

// See docs/decisions.md "Trigger, duration, and jitter (issue #8 design)" —
// the poll cadence itself doesn't need jitter, since unblock_at was already
// randomized once at block time.
const POLL_INTERVAL_MS = Number(process.env.UNBLOCK_POLL_INTERVAL_MS ?? 2 * 60 * 1000);

const logger = pino({ name: 'unblock-scheduler' });

/**
 * Polls for blocks whose unblock_at has passed and unblocks them. Calls
 * actions.unblock before marking a block resolved, never after — an
 * unconfirmed unblock must not be recorded as done, or a failed WhatsApp
 * call would leave the contact blocked forever with nothing left to retry
 * it (see AGENTS.md "Error handling").
 *
 * A tick that's still running when the next one is due is skipped rather
 * than overlapped, since actions.unblock (and the getExpiredBlocks/
 * markUnblocked round-trip) can outlast POLL_INTERVAL_MS.
 *
 * @param {{ unblock: (contactId: string) => Promise<void> }} actions
 * @returns {{ stop: () => void }}
 */
export function startUnblockScheduler(actions) {
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      for (const record of getExpiredBlocks()) {
        try {
          await actions.unblock(record.contact_id);
        } catch (err) {
          logger.error(
            { contactId: record.contact_id, blockId: record.id, error: err?.message ?? String(err) },
            'unblock failed; will retry next tick',
          );
          continue;
        }

        if (markUnblocked(record.id)) {
          logger.info({ contactId: record.contact_id, blockId: record.id }, 'contact unblocked');
        } else {
          logger.warn(
            { contactId: record.contact_id, blockId: record.id },
            'block was already marked unblocked (overlapping tick or manual override)',
          );
        }
      }
    } finally {
      running = false;
    }
  }

  const timer = setInterval(tick, POLL_INTERVAL_MS);
  return { stop: () => clearInterval(timer) };
}
