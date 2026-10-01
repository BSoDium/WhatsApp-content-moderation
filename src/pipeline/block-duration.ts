import { getBlockHistory } from '../store/blocks.ts';
import { getBoolSetting, getNumberSetting } from '../store/settings.ts';
import type { BlockRecord } from '../types.ts';

/**
 * How many consecutive earlier blocks lead up to `now`. `history` is newest
 * first; the chain breaks at the first gap, from one block's end to the next
 * block's start, longer than `resetMs`.
 */
export function countRecentBlocks(history: readonly BlockRecord[], now: number, resetMs: number): number {
  let count = 0;
  let nextStart = now;
  for (const record of history) {
    const end = record.unblocked_at ?? record.unblock_at;
    if (nextStart - end > resetMs) break;
    count += 1;
    nextStart = record.blocked_at;
  }
  return count;
}

/**
 * Block length before jitter: the fixed BLOCK_DURATION_MS, or, with
 * BLOCK_ESCALATING on, the first-block length multiplied by the factor once
 * per recent block and capped at the longest allowed.
 */
export function baseBlockDurationMs(contactId: string, now = Date.now()): number {
  if (!getBoolSetting('BLOCK_ESCALATING')) return getNumberSetting('BLOCK_DURATION_MS');

  const recentBlocks = countRecentBlocks(getBlockHistory(contactId), now, getNumberSetting('BLOCK_ESCALATION_RESET_MS'));
  const escalated = getNumberSetting('BLOCK_ESCALATION_BASE_MS') * getNumberSetting('BLOCK_ESCALATION_FACTOR') ** recentBlocks;
  return Math.round(Math.min(escalated, getNumberSetting('BLOCK_ESCALATION_MAX_MS')));
}
