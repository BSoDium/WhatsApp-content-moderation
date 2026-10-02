import type { ConversationMessage } from '../classifier/classifier.ts';
import type { AuditLogRecord } from '../types.ts';

const WARNING_SENT_ACTION = 'warning_sent';
const REMOVED_ACTIONS = ['delete+warn', 'delete'];

/**
 * Turns audit rows (newest first, as getAuditLog returns them) into the
 * classifier's conversation history, oldest first. A removal only counts as
 * one if it happened at or after `removalCutoff`.
 */
export function toConversationHistory(rowsNewestFirst: AuditLogRecord[], removalCutoff: number): ConversationMessage[] {
  return [...rowsNewestFirst].reverse().map((row) => ({
    from: row.direction === 'me' ? 'me' : 'them',
    text: row.message,
    automated: row.action === WARNING_SENT_ACTION,
    removedAs: REMOVED_ACTIONS.includes(row.action) && row.created_at >= removalCutoff ? (row.category ?? 'violation') : undefined,
  }));
}
