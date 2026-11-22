import { toConversationHistory } from '../pipeline/history.ts';
import { getAuditLog } from '../store/audit-log.ts';
import { getNumberSetting } from '../store/settings.ts';
import type { ConversationMessage } from './classifier.ts';

/**
 * The conversation as it stood just before an audit-log message, oldest
 * first, built the way the live pipeline builds it. Removals only count as
 * such inside the same window the pipeline uses, so a replayed verdict sees
 * what the classifier saw then.
 */
export function conversationBefore(contactId: string, auditLogId: number, createdAt: number, limit = getNumberSetting('CLASSIFIER_HISTORY_LIMIT')): ConversationMessage[] {
  const rows = getAuditLog(contactId, limit + 1, createdAt)
    .filter((row) => row.id < auditLogId)
    .slice(0, limit);
  return toConversationHistory(rows, createdAt - getNumberSetting('REMOVED_CONTEXT_WINDOW_MS'));
}
