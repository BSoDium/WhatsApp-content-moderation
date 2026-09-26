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
 *   runCommand: (command: 'pause' | 'resume' | 'status' | 'unblock') => Promise<string | null>,
 * }}
 */
export function createManualOverride({ targetContactId, unblock }) {
  let paused = false;

  // Structured form of "status", for a caller (src/web/control-server.js's
  // JSON API) that wants fields to render rather than a formatted string —
  // runCommand('status') below is just this, rendered as text.
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

      case 'status': {
        const status = getStatus();
        const blockStatus = status.block ? `blocked until ${new Date(status.block.unblockAt).toISOString()}` : 'not blocked';
        return `Paused: ${status.paused}\nStrikes: ${status.strikeCount}\nBlock: ${blockStatus}`;
      }

      case 'unblock': {
        const block = getActiveBlock(targetContactId);
        if (!block) return 'Contact is not currently blocked.';

        try {
          await unblock(targetContactId);
        } catch (err) {
          logger.error({ error: err?.message ?? String(err) }, 'manual unblock failed');
          return `Unblock failed: ${err?.message ?? String(err)}`;
        }

        markUnblocked(block.id);
        logger.info({ targetContactId, blockId: block.id }, 'contact manually unblocked via manual override');
        return 'Contact unblocked.';
      }

      default:
        return null;
    }
  }

  return { isPaused: () => paused, getStatus, runCommand };
}
