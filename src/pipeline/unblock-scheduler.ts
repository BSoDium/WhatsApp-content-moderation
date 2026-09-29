import { createLogger } from '../cli/logger.ts';
import { getExpiredBlocks } from '../store/blocks.ts';
import { resolveUnblock } from './unblock-resolution.ts';
import { getNumberSetting } from '../store/settings.ts';

interface UnblockActions {
  unblock: (contactId: string) => Promise<void>;
}

const logger = createLogger('unblock-scheduler');

/**
 * Runs one poll pass: unblocks every expired block via actions.unblock,
 * then marks it resolved (see startUnblockScheduler's JSDoc for why in
 * that order). Exported so tests can drive a single pass directly against
 * a real store instead of waiting on setInterval.
 *
 * @param {{ unblock: (contactId: string) => Promise<void> }} actions
 * @returns {Promise<void>}
 */
export async function runTick(actions: UnblockActions): Promise<void> {
  for (const record of getExpiredBlocks()) {
    const outcome = await resolveUnblock(record.contact_id, record.id, actions.unblock);
    switch (outcome.status) {
      case 'unblocked':
        logger.info({ contactId: record.contact_id, blockId: record.id }, 'contact unblocked');
        break;
      case 'already-resolved':
        logger.warn(
          { contactId: record.contact_id, blockId: record.id },
          'block was already marked unblocked (overlapping tick, manual override, or an unblock made from the phone)',
        );
        break;
      case 'failed':
        logger.error(
          { contactId: record.contact_id, blockId: record.id, error: outcome.error },
          'unblock failed; will retry next tick',
        );
        break;
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
 * Self-reschedules via setTimeout rather than a fixed setInterval, reading
 * the UNBLOCK_POLL_INTERVAL_MS setting fresh before each reschedule — so an
 * edit made via the control app changes the cadence starting with the next
 * tick, not only after a restart. This also means a tick can never overlap
 * the next one (the next tick isn't scheduled until this one settles), and
 * a tick's own failure (e.g. a SQLite error, possibly from the DB closing
 * mid-tick during shutdown) is caught and logged here rather than left to
 * escape — an uncaught rejection here would crash the whole process, not
 * just this scheduler.
 *
 * stop() is async and waits for any tick already in flight, and marks the
 * scheduler stopped before doing so, so the in-flight tick's own reschedule
 * (in its `finally`) is suppressed instead of leaving a dangling timer that
 * fires again after a caller (index.ts's shutdown()) has already moved on
 * to close the DB.
 *
 * @param {{ unblock: (contactId: string) => Promise<void> }} actions
 * @returns {{ stop: () => Promise<void> }}
 */
export function startUnblockScheduler(actions: UnblockActions): { stop: () => Promise<void> } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | null = null;
  let stopped = false;

  function scheduleNext() {
    if (stopped) return;
    timer = setTimeout(tick, getNumberSetting('UNBLOCK_POLL_INTERVAL_MS'));
  }

  function tick() {
    inFlight = runTick(actions)
      .catch((err) => logger.error({ error: err instanceof Error ? err.message : String(err) }, 'scheduler tick failed'))
      .finally(() => {
        inFlight = null;
        scheduleNext();
      });
  }

  scheduleNext();

  return {
    stop: async () => {
      stopped = true;
      clearTimeout(timer);
      await inFlight;
    },
  };
}
