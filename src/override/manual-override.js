import pino from 'pino';
import { getStrikeCount } from '../store/strikes.js';
import { getActiveBlock, markUnblocked } from '../store/blocks.js';

const logger = pino({ name: 'manual-override' });

/**
 * Creates the pause/status/unblock routines behind issue #9 (manual
 * override — see docs/decisions.md "Manual override channel (issue #9)").
 * This module is the control primitives only: it doesn't listen for or
 * parse anything itself. The issue originally called for driving these via
 * WhatsApp self-chat commands, but per the issue's own follow-up comment
 * that's the wrong control surface — too primitive for things like rate
 * limiting, and it doesn't compose with a real UI. These routines are kept
 * so a proper interface (planned: a VPN-accessible web app hosted by the
 * same process) has something to call into once it exists.
 *
 * Pause state lives only in memory (reset on restart) — same trust model as
 * the rest of the runtime pipeline, and simpler than persisting a flag whose
 * whole purpose is a temporary human override.
 *
 * @param {{
 *   targetContactId: string,
 *   unblock: (contactId: string) => Promise<void>,
 * }} deps
 * @returns {{
 *   isPaused: () => boolean,
 *   getStatus: () => { paused: boolean, strikeCount: number, block: { unblockAt: number } | null },
 *   runCommand: (command: 'pause' | 'resume' | 'unblock') => Promise<string | null>,
 * }}
 */
export function createManualOverride({ targetContactId, unblock }) {
  let paused = false;
  // contactIds with an unblock in flight, so concurrent 'unblock' calls can't both call the real unblock() action.
  const unblockInFlight = new Set();

  // Structured form of "status" for a JSON caller (src/web/control-server.js).
  function getStatus() {
    const strikeCount = getStrikeCount(targetContactId);
    const activeBlock = getActiveBlock(targetContactId);
    return { paused, strikeCount, block: activeBlock ? { unblockAt: activeBlock.unblock_at } : null };
  }

  async function runCommand(command) {
    switch (command) {
      case 'pause':
        paused = true;
        logger.info('moderation paused via manual override');
        return 'Moderation paused — incoming messages will not be classified or actioned until resumed.';

      case 'resume':
        paused = false;
        logger.info('moderation resumed via manual override');
        return 'Moderation resumed.';

      case 'unblock': {
        if (unblockInFlight.has(targetContactId)) return 'Unblock already in progress.';

        const block = getActiveBlock(targetContactId);
        if (!block) return 'Contact is not currently blocked.';

        unblockInFlight.add(targetContactId);
        try {
          try {
            await unblock(targetContactId);
          } catch (err) {
            logger.error({ error: err?.message ?? String(err) }, 'manual unblock failed');
            return `Unblock failed: ${err?.message ?? String(err)}`;
          }

          // Matches src/pipeline/unblock-scheduler.js's runTick — don't report success for a block someone else already resolved.
          if (!markUnblocked(block.id)) {
            logger.warn({ targetContactId, blockId: block.id }, 'block was already marked unblocked (overlapping request or scheduler tick)');
            return 'Contact was already unblocked.';
          }

          logger.info({ targetContactId, blockId: block.id }, 'contact manually unblocked via manual override');
          return 'Contact unblocked.';
        } finally {
          unblockInFlight.delete(targetContactId);
        }
      }

      default:
        return null;
    }
  }

  return { isPaused: () => paused, getStatus, runCommand };
}
