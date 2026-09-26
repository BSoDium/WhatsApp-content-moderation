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
 * so a proper interface (the VPN-accessible web app, issue #29) has
 * something to call into.
 *
 * Every method takes a contactId explicitly — this registry serves every
 * contact on the monitored-contacts roster (issue #32), not one fixed
 * target — see docs/decisions.md "Multi-contact moderation roster".
 *
 * Pause state lives only in memory, per contact (reset on restart) — same
 * trust model as the rest of the runtime pipeline, and simpler than
 * persisting a flag whose whole purpose is a temporary human override.
 *
 * @param {{ unblock: (contactId: string) => Promise<void> }} deps
 * @returns {{
 *   isPaused: (contactId: string) => boolean,
 *   getStatus: (contactId: string) => { paused: boolean, strikeCount: number, block: { unblockAt: number } | null },
 *   runCommand: (contactId: string, command: 'pause' | 'resume' | 'unblock') => Promise<string | null>,
 * }}
 */
export function createManualOverride({ unblock }) {
  const paused = new Map();
  // contactIds with an unblock in flight, so concurrent 'unblock' calls for the same contact can't both call the real unblock() action.
  const unblockInFlight = new Set();

  function isPaused(contactId) {
    return paused.get(contactId) ?? false;
  }

  // Structured form of "status" for a JSON caller (src/web/control-server.js).
  function getStatus(contactId) {
    const strikeCount = getStrikeCount(contactId);
    const activeBlock = getActiveBlock(contactId);
    return { paused: isPaused(contactId), strikeCount, block: activeBlock ? { unblockAt: activeBlock.unblock_at } : null };
  }

  async function runCommand(contactId, command) {
    switch (command) {
      case 'pause':
        paused.set(contactId, true);
        logger.info({ contactId }, 'moderation paused via manual override');
        return 'Moderation paused — incoming messages will not be classified or actioned until resumed.';

      case 'resume':
        paused.set(contactId, false);
        logger.info({ contactId }, 'moderation resumed via manual override');
        return 'Moderation resumed.';

      case 'unblock': {
        if (unblockInFlight.has(contactId)) return 'Unblock already in progress.';

        const block = getActiveBlock(contactId);
        if (!block) return 'Contact is not currently blocked.';

        unblockInFlight.add(contactId);
        try {
          try {
            await unblock(contactId);
          } catch (err) {
            logger.error({ contactId, error: err?.message ?? String(err) }, 'manual unblock failed');
            return `Unblock failed: ${err?.message ?? String(err)}`;
          }

          // Matches src/pipeline/unblock-scheduler.js's runTick — don't report success for a block someone else already resolved.
          if (!markUnblocked(block.id)) {
            logger.warn({ contactId, blockId: block.id }, 'block was already marked unblocked (overlapping request or scheduler tick)');
            return 'Contact was already unblocked.';
          }

          logger.info({ contactId, blockId: block.id }, 'contact manually unblocked via manual override');
          return 'Contact unblocked.';
        } finally {
          unblockInFlight.delete(contactId);
        }
      }

      default:
        return null;
    }
  }

  return { isPaused, getStatus, runCommand };
}
