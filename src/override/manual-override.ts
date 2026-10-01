import { createLogger } from '../cli/logger.ts';
import { getStrikeCount, resetStrikes } from '../store/strikes.ts';
import { getActiveBlock } from '../store/blocks.ts';
import { getCallState, resetCallState } from '../store/call-strikes.ts';
import { getEffectiveNuisanceThreshold } from '../store/monitored-contacts.ts';
import { emitControlEvent } from '../store/events.ts';
import { resolveUnblock } from '../pipeline/unblock-resolution.ts';

type OverrideCommand = 'pause' | 'resume' | 'unblock' | 'reset-strikes';

const logger = createLogger('manual-override');

/**
 * Creates the pause/status/unblock/reset-strikes routines behind issue #9 (manual
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
 *   getStatus: (contactId: string) => { paused: boolean, strikeCount: number, block: { unblockAt: number } | null, callNuisance: { unansweredCount: number, strikeCount: number, threshold: number } },
 *   runCommand: (contactId: string, command: 'pause' | 'resume' | 'unblock' | 'reset-strikes') => Promise<string | null>,
 * }}
 */
export function createManualOverride({ unblock }: { unblock: (contactId: string) => Promise<void> }) {
  const paused = new Map<string, boolean>();
  // contactIds with an unblock in flight, so concurrent 'unblock' calls for the same contact can't both call the real unblock() action.
  const unblockInFlight = new Set<string>();

  function isPaused(contactId: string): boolean {
    return paused.get(contactId) ?? false;
  }

  // Structured form of "status" for a JSON caller (src/web/control-server.ts).
  function getStatus(contactId: string): {
    paused: boolean;
    strikeCount: number;
    block: { unblockAt: number } | null;
    callNuisance: { unansweredCount: number; strikeCount: number; threshold: number };
  } {
    const strikeCount = getStrikeCount(contactId);
    const activeBlock = getActiveBlock(contactId);
    const callState = getCallState(contactId);
    return {
      paused: isPaused(contactId),
      strikeCount,
      block: activeBlock ? { unblockAt: activeBlock.unblock_at } : null,
      callNuisance: {
        unansweredCount: callState.unansweredCount,
        strikeCount: callState.strikeCount,
        threshold: getEffectiveNuisanceThreshold(contactId),
      },
    };
  }

  async function runCommand(contactId: string, command: OverrideCommand): Promise<string | null> {
    switch (command) {
      case 'pause':
        paused.set(contactId, true);
        logger.info({ contactId }, 'moderation paused via manual override');
        emitControlEvent('roster');
        return 'Moderation paused — incoming messages and calls will not be classified or actioned until resumed.';

      case 'resume':
        paused.set(contactId, false);
        logger.info({ contactId }, 'moderation resumed via manual override');
        emitControlEvent('roster');
        return 'Moderation resumed.';

      case 'reset-strikes':
        resetStrikes(contactId);
        resetCallState(contactId);
        logger.info({ contactId }, 'strikes reset via manual override');
        emitControlEvent('roster');
        return 'Strikes reset.';

      case 'unblock': {
        if (unblockInFlight.has(contactId)) return 'Unblock already in progress.';

        const block = getActiveBlock(contactId);
        if (!block) return 'Contact is not currently blocked.';

        unblockInFlight.add(contactId);
        try {
          // Shared with src/pipeline/unblock-scheduler.ts's runTick — same
          // call-unblock-then-mark-resolved sequence and the same "someone
          // else already resolved it" race handling either way.
          const outcome = await resolveUnblock(contactId, block.id, unblock);
          if (outcome.status === 'failed') {
            logger.error({ contactId, error: outcome.error }, 'manual unblock failed');
            return `Unblock failed: ${outcome.error}`;
          }
          if (outcome.status === 'already-resolved') {
            logger.warn({ contactId, blockId: block.id }, 'block was already marked unblocked (overlapping request, scheduler tick, or an unblock made from the phone)');
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
