import { classifyMessage } from './classifier.ts';
import { conversationBefore } from './example-context.ts';
import { getAuditLog } from '../store/audit-log.ts';
import { getMonitored } from '../store/monitored-contacts.ts';
import type { LabelledExample } from '../store/corrections.ts';

export interface BacktestInput {
  scope: 'global' | 'contact';
  candidate: string;
  examples: LabelledExample[];
  classify?: typeof classifyMessage;
}

export interface LabelledOutcome {
  auditLogId: number;
  contactId: string;
  message: string;
  verdict: LabelledExample['verdict'];
  // What the candidate decides now, or null when the classifier failed.
  nowFlagged: boolean | null;
  wasCorrect: boolean;
  nowCorrect: boolean | null;
}

export interface Flip {
  auditLogId: number;
  contactId: string;
  message: string;
  wasFlagged: boolean;
  nowFlagged: boolean;
}

export interface BacktestResult {
  labelled: LabelledOutcome[];
  flips: Flip[];
  summary: { labelled: number; correctBefore: number; correctNow: number; failed: number; checkedUnlabelled: number };
}

// Bounds how long a backtest can run at CPU decode speeds, where each classification takes seconds.
const MAX_CONTACTS_CHECKED_FOR_FLIPS = 4;
const UNLABELLED_PER_CONTACT = 8;
const UNLABELLED_LOOKBACK_ROWS = 60;
const CHECKABLE_ACTIONS = ['none', 'shadow', 'delete+warn', 'delete'];

async function verdictWith(input: BacktestInput, contactId: string, auditLogId: number, createdAt: number, message: string): Promise<boolean | null> {
  const classify = input.classify ?? classifyMessage;
  const history = conversationBefore(contactId, auditLogId, createdAt);
  const contactContext = input.scope === 'contact' ? input.candidate : (getMonitored(contactId)?.context ?? undefined);
  const result = await classify({ message, history, contactContext }, input.scope === 'global' ? { policy: input.candidate } : {});
  return result.ok ? result.flagged : null;
}

/**
 * Runs a candidate rule through the real classifier over every labelled
 * message, plus a sample of each involved contact's other recent messages, so
 * the operator sees what accepting it would change before it changes
 * anything. Classifications run one at a time: a local model serves one
 * request at a time anyway, and this keeps a backtest from starving live
 * moderation.
 *
 * A classifier failure on a message is counted, never guessed: it is neither
 * correct nor a flip.
 */
export async function backtestRule(input: BacktestInput): Promise<BacktestResult> {
  const labelled: LabelledOutcome[] = [];
  for (const example of input.examples) {
    const nowFlagged = await verdictWith(input, example.contactId, example.auditLogId, example.createdAt, example.message);
    const unacceptable = example.verdict === 'unacceptable';
    labelled.push({
      auditLogId: example.auditLogId,
      contactId: example.contactId,
      message: example.message,
      verdict: example.verdict,
      nowFlagged,
      wasCorrect: example.flagged === unacceptable,
      nowCorrect: nowFlagged === null ? null : nowFlagged === unacceptable,
    });
  }

  const labelledIds = new Set(input.examples.map((example) => example.auditLogId));
  const contacts = [...new Set(input.examples.map((example) => example.contactId))].slice(0, MAX_CONTACTS_CHECKED_FOR_FLIPS);
  const flips: Flip[] = [];
  let checkedUnlabelled = 0;
  for (const contactId of contacts) {
    const rows = getAuditLog(contactId, UNLABELLED_LOOKBACK_ROWS)
      .filter((row) => row.direction === 'them' && row.classification_ok === 1 && row.flagged !== null && CHECKABLE_ACTIONS.includes(row.action) && !labelledIds.has(row.id))
      .slice(0, UNLABELLED_PER_CONTACT);
    for (const row of rows) {
      const nowFlagged = await verdictWith(input, contactId, row.id, row.created_at, row.message);
      checkedUnlabelled += 1;
      if (nowFlagged !== null && nowFlagged !== (row.flagged === 1)) {
        flips.push({ auditLogId: row.id, contactId, message: row.message, wasFlagged: row.flagged === 1, nowFlagged });
      }
    }
  }

  return {
    labelled,
    flips,
    summary: {
      labelled: labelled.length,
      correctBefore: labelled.filter((outcome) => outcome.wasCorrect).length,
      correctNow: labelled.filter((outcome) => outcome.nowCorrect).length,
      failed: labelled.filter((outcome) => outcome.nowFlagged === null).length,
      checkedUnlabelled,
    },
  };
}
