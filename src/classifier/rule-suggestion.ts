import { backtestRule } from './rule-backtest.ts';
import type { BacktestResult } from './rule-backtest.ts';
import { conversationBefore } from './example-context.ts';
import { getPolicyText } from './policy.ts';
import { proposeRule } from './rule-proposer.ts';
import type { RuleProposalInput } from './rule-proposer.ts';
import { getLabelledExamples } from '../store/corrections.ts';
import { getMonitored } from '../store/monitored-contacts.ts';
import { MAX_CONTEXT_LENGTH, MAX_POLICY_LENGTH } from '../store/rule-limits.ts';

export type RuleScope = 'global' | { contactId: string };

export type RuleSuggestionResult =
  | { ok: true; currentRule: string; candidate: string; rationale: string; backtest: BacktestResult }
  | { ok: false; reason: 'no-labels' | 'not-monitored' | 'proposal-failed'; error: string };

interface RuleSuggestionDependencies {
  propose?: typeof proposeRule;
  backtest?: typeof backtestRule;
}

// Keeps both the prompt and the backtest within what a local model can finish in a few minutes.
const MAX_LABELLED_EXAMPLES = 24;
const PROPOSER_CONTEXT_MESSAGES = 6;


/**
 * Proposes a rule from the operator's labelled messages and backtests it,
 * without saving anything: the caller shows the result and only the
 * operator's explicit accept goes through the existing policy/context
 * setters. Fails open: a missing label set, an unreachable model or a
 * malformed answer returns { ok: false } and leaves every rule as it was.
 */
export async function suggestRule(scope: RuleScope, { propose = proposeRule, backtest = backtestRule }: RuleSuggestionDependencies = {}): Promise<RuleSuggestionResult> {
  const contactId = scope === 'global' ? undefined : scope.contactId;
  const monitored = contactId === undefined ? undefined : getMonitored(contactId);
  if (contactId !== undefined && !monitored) return { ok: false, reason: 'not-monitored', error: 'this contact is not monitored' };

  const examples = getLabelledExamples({ contactId, limit: MAX_LABELLED_EXAMPLES });
  if (examples.length === 0) return { ok: false, reason: 'no-labels', error: 'label some messages in the activity panel first' };

  const currentRule = contactId === undefined ? getPolicyText() : (monitored?.context ?? '');
  const proposalInput: RuleProposalInput = {
    scope: contactId === undefined ? 'global' : 'contact',
    currentRule,
    maxLength: contactId === undefined ? MAX_POLICY_LENGTH : MAX_CONTEXT_LENGTH,
    examples: examples.map((example) => ({
      message: example.message,
      conversation: conversationBefore(example.contactId, example.auditLogId, example.createdAt, PROPOSER_CONTEXT_MESSAGES),
      verdict: example.verdict,
      note: example.note,
    })),
  };

  const proposal = await propose(proposalInput);
  if (!proposal.ok) return { ok: false, reason: 'proposal-failed', error: proposal.error };

  const result = await backtest({ scope: proposalInput.scope, candidate: proposal.rule, examples });
  return { ok: true, currentRule, candidate: proposal.rule, rationale: proposal.rationale, backtest: result };
}
