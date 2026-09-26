import pino from 'pino';
import { getStrikeCount } from '../store/strikes.js';
import { getActiveBlock, markUnblocked } from '../store/blocks.js';

const logger = pino({ name: 'override-channel' });

const COMMANDS = new Set(['!pause', '!resume', '!unblock', '!status']);

/**
 * Parses the first whitespace-separated word of `text` into a recognized
 * override command ('pause' | 'resume' | 'unblock' | 'status'), or null if
 * it isn't one. Case-insensitive; anything after the command word is
 * ignored, since none of these commands take arguments — there's exactly
 * one TARGET_CONTACT_JID to act on.
 */
export function parseOverrideCommand(text) {
  const word = text.trim().split(/\s+/)[0]?.toLowerCase();
  return COMMANDS.has(word) ? word.slice(1) : null;
}

/**
 * Extracts the text of one incoming Baileys message if it's a self-sent
 * message in the account's own "Message yourself" chat, or null otherwise.
 * Mirrors src/pipeline/incoming-message.js's extractIncomingMessage, but
 * gated the opposite way: fromMe must be true (only the account owner can
 * send an override) and remoteJid must equal the account's own JID rather
 * than the moderated contact's.
 *
 * @param {object} msg - one entry from a Baileys `messages.upsert` event
 * @param {string} selfJid - the account's own (normalized) JID
 * @param {string} [type] - the `messages.upsert` event's own `type` field
 * @returns {string | null}
 */
export function extractOverrideMessage(msg, selfJid, type = 'notify') {
  if (type !== 'notify') return null;
  if (!msg.message) return null;
  if (!msg.key.fromMe) return null;
  if (!selfJid || msg.key.remoteJid !== selfJid) return null;

  return msg.message.conversation ?? msg.message.extendedTextMessage?.text ?? null;
}

/**
 * Creates the manual override channel (docs/roadmap.md issue #9): tracks a
 * runtime pause flag and runs !pause/!resume/!unblock/!status commands sent
 * from the account's own "Message yourself" chat, so the bot can be
 * intervened on without shelling into the host machine.
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
 *   runCommand: (command: string) => Promise<string | null>,
 * }}
 */
export function createOverrideChannel({ targetContactId, unblock }) {
  let paused = false;

  async function runCommand(command) {
    switch (command) {
      case 'pause':
        paused = true;
        logger.info('moderation paused via override channel');
        return 'Moderation paused — incoming messages will not be classified or actioned until !resume.';

      case 'resume':
        paused = false;
        logger.info('moderation resumed via override channel');
        return 'Moderation resumed.';

      case 'status': {
        const strikeCount = getStrikeCount(targetContactId);
        const block = getActiveBlock(targetContactId);
        const blockStatus = block ? `blocked until ${new Date(block.unblock_at).toISOString()}` : 'not blocked';
        return `Paused: ${paused}\nStrikes: ${strikeCount}\nBlock: ${blockStatus}`;
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
        logger.info({ targetContactId, blockId: block.id }, 'contact manually unblocked via override channel');
        return 'Contact unblocked.';
      }

      default:
        return null;
    }
  }

  return { isPaused: () => paused, runCommand };
}
