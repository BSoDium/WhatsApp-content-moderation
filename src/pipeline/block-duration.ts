import { getBlockHistory } from '../store/blocks.ts';
import { getMonitored } from '../store/monitored-contacts.ts';
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
 * BLOCK_BACKOFF on, the first-block length multiplied by the factor once
 * per recent block and capped at the longest allowed.
 */
export function baseBlockDurationMs(contactId: string, now = Date.now()): number {
  if (!getBoolSetting('BLOCK_BACKOFF')) return getNumberSetting('BLOCK_DURATION_MS');

  const recentBlocks = countRecentBlocks(getBlockHistory(contactId), now, getNumberSetting('BLOCK_BACKOFF_RESET_MS'));
  const escalated = getNumberSetting('BLOCK_BACKOFF_BASE_MS') * getNumberSetting('BLOCK_BACKOFF_FACTOR') ** recentBlocks;
  const maxMs = getMonitored(contactId)?.blockBackoffMaxMs ?? getNumberSetting('BLOCK_BACKOFF_MAX_MS');
  return Math.round(Math.min(escalated, maxMs));
}
