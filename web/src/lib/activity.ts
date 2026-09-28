import type { AuditAction } from './types';

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

interface ActionMeta {
  label: string;
  badgeVariant: BadgeVariant;
}

// Red is reserved for classifier_error/action_failed; a delete is the system working as intended, not a failure needing an alarm color.
export const ACTION_META: Record<AuditAction, ActionMeta> = {
  'delete+warn': { label: 'Deleted', badgeVariant: 'default' },
  warning_sent: { label: 'Warning sent', badgeVariant: 'secondary' },
  none: { label: 'Passed', badgeVariant: 'outline' },
  classifier_error: { label: 'Classifier error', badgeVariant: 'destructive' },
  action_failed: { label: 'Action failed', badgeVariant: 'destructive' },
  shadow: { label: 'Shadow mode', badgeVariant: 'secondary' },
  call_received: { label: 'Call received', badgeVariant: 'outline' },
  call_unanswered: { label: 'Call unanswered', badgeVariant: 'outline' },
  call_answered: { label: 'Call answered', badgeVariant: 'outline' },
  call_nuisance_warned: { label: 'Nuisance call warned', badgeVariant: 'secondary' },
  call_reject_failed: { label: 'Call reject failed', badgeVariant: 'destructive' },
  call_warn_failed: { label: 'Call warning failed', badgeVariant: 'destructive' },
  call_shadow: { label: 'Shadow mode (call)', badgeVariant: 'secondary' },
};

// Every value the filter's Select offers — the order they're listed in.
export const ACTION_FILTER_OPTIONS: AuditAction[] = [
  'delete+warn',
  'warning_sent',
  'none',
  'classifier_error',
  'action_failed',
  'shadow',
  'call_received',
  'call_unanswered',
  'call_answered',
  'call_nuisance_warned',
  'call_reject_failed',
  'call_warn_failed',
  'call_shadow',
];

export function actionMeta(action: string): ActionMeta {
  return (ACTION_META as Record<string, ActionMeta>)[action] ?? { label: action, badgeVariant: 'outline' };
}

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

export function formatTimestamp(ms: number): string {
  return DATE_TIME_FORMAT.format(new Date(ms));
}

// Categories come from the classifier as snake_case labels (e.g. "unwanted_contact") — display-only
// formatting, never sent back to the API. Sentence case (not CSS `capitalize`, which title-cases
// every word) so this reads the same wherever it's used.
export function formatCategory(category: string): string {
  const spaced = category.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
