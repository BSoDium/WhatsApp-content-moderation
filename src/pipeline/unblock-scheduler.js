import pino from 'pino';
import { getExpiredBlocks, markUnblocked } from '../store/blocks.js';

// The poll cadence itself doesn't need jitter — see docs/decisions.md "Trigger, duration, and jitter (issue #8 design)".
const POLL_INTERVAL_MS = Number(process.env.UNBLOCK_POLL_INTERVAL_MS ?? 2 * 60 * 1000);

const logger = pino({ name: 'unblock-scheduler' });

/**
 * Runs one poll pass: unblocks every expired block via actions.unblock,
 * then marks it resolved (see startUnblockScheduler's JSDoc for why in
 * that order). Exported so tests can drive a single pass directly against
 * a real store instead of waiting on setInterval.
 *
 * @param {{ unblock: (contactId: string) => Promise<void> }} actions
 * @returns {Promise<void>}
 */
export async function runTick(actions) {
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
}

/**
 * Polls for blocks whose unblock_at has passed and unblocks them. Calls
 * actions.unblock before marking a block resolved, never after — an
 * unconfirmed unblock must not be recorded as done, or a failed WhatsApp
 * call would leave the contact blocked forever with nothing left to retry
 * it (see AGENTS.md "Error handling").
 *
 * A tick that's still running when the next one is due is skipped rather
 * than overlapped, since actions.unblock (and the getExpiredBlocks/
 * markUnblocked round-trip) can outlast POLL_INTERVAL_MS. A tick's own
 * failure (e.g. a SQLite error, possibly from the DB closing mid-tick
 * during shutdown) is caught and logged here rather than left to escape —
 * setInterval has no way to catch a rejected callback, so an uncaught one
 * would crash the whole process, not just this scheduler.
 *
 * stop() is async and waits for any tick already in flight, so a caller
 * (index.js's shutdown()) can safely close the DB right after it resolves
 * without racing a tick's own markUnblocked call.
 *
 * @param {{ unblock: (contactId: string) => Promise<void> }} actions
 * @returns {{ stop: () => Promise<void> }}
 */
export function startUnblockScheduler(actions) {
  let inFlight = null;

  function tick() {
    if (inFlight) return;
    inFlight = runTick(actions)
      .catch((err) => logger.error({ error: err?.message ?? String(err) }, 'scheduler tick failed'))
      .finally(() => {
        inFlight = null;
      });
  }

  const timer = setInterval(tick, POLL_INTERVAL_MS);
  return {
    stop: async () => {
      clearInterval(timer);
      await inFlight;
    },
  };
}
