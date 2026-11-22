import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { apiFetch } from '@/lib/api';
import type { RuleSuggestion } from '@/lib/types';

const FLIPS_SHOWN = 5;
const MESSAGE_PREVIEW_CHARS = 90;

type State = { status: 'idle' } | { status: 'running' } | { status: 'error'; message: string } | { status: 'ready'; suggestion: RuleSuggestion };

interface SuggestRuleProps {
  // 'global' for the policy, or a contact id for that contact's moderation context.
  scope: string;
  // Puts the candidate in the editor as an unsaved draft; saving stays the operator's own step.
  onUse: (rule: string) => void;
  disabled?: boolean;
  // The editor holds edits that are not saved yet, which using the candidate would overwrite.
  replacesUnsaved?: boolean;
}

function preview(message: string): string {
  return message.length > MESSAGE_PREVIEW_CHARS ? `${message.slice(0, MESSAGE_PREVIEW_CHARS)}…` : message;
}

export function SuggestRule({ scope, onUse, disabled, replacesUnsaved }: SuggestRuleProps) {
  const [state, setState] = useState<State>({ status: 'idle' });

  async function suggest() {
    setState({ status: 'running' });
    try {
      const suggestion = await apiFetch<RuleSuggestion>('/api/rules/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope }),
      });
      setState({ status: 'ready', suggestion });
    } catch (err: unknown) {
      setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  const running = state.status === 'running';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={suggest} disabled={disabled || running}>
          {running ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="size-3.5" aria-hidden="true" />}
          Suggest rule from labels
        </Button>
        {running && <p className="text-sm text-muted-foreground">Asking the model, then testing the result on your labelled messages. This can take a few minutes on CPU-only hardware.</p>}
        {state.status === 'idle' && <p className="text-sm text-muted-foreground">Uses the messages you labelled in the activity panel. Nothing changes until you save.</p>}
      </div>

      {state.status === 'error' && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}

      {state.status === 'ready' && <Suggestion suggestion={state.suggestion} replacesUnsaved={replacesUnsaved} onUse={(rule) => { onUse(rule); setState({ status: 'idle' }); }} onDiscard={() => setState({ status: 'idle' })} />}
    </div>
  );
}

function Suggestion({ suggestion, replacesUnsaved, onUse, onDiscard }: { suggestion: RuleSuggestion; replacesUnsaved?: boolean; onUse: (rule: string) => void; onDiscard: () => void }) {
  const { summary, flips } = suggestion.backtest;
  const worse = summary.correctNow < summary.correctBefore;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3.5">
      {suggestion.rationale && <p className="text-sm">{suggestion.rationale}</p>}
      <pre className="max-h-64 overflow-y-auto rounded-md bg-muted px-3 py-2 font-mono text-sm whitespace-pre-wrap">{suggestion.candidate}</pre>

      <Separator />

      <div className="flex flex-col gap-1 text-sm">
        <p className="font-medium">Tested on your labels</p>
        <p>
          Judged correctly: {summary.correctBefore} of {summary.labelled} before, <span className={worse ? 'text-destructive' : undefined}>{summary.correctNow} of {summary.labelled}</span> with this rule.
        </p>
        {summary.failed > 0 && <p className="text-muted-foreground">{summary.failed} could not be classified and are not counted.</p>}
        {replacesUnsaved && <p className="text-muted-foreground">Written against the saved rule, not your unsaved edits; using it replaces them.</p>}
        <p className="text-muted-foreground">
          {flips.length === 0 ? `No other recent messages (${summary.checkedUnlabelled} checked) would be judged differently.` : `${flips.length} of ${summary.checkedUnlabelled} other recent messages would be judged differently:`}
        </p>
        {flips.slice(0, FLIPS_SHOWN).map((flip) => (
          <p key={flip.auditLogId} className="text-muted-foreground">
            {flip.nowFlagged ? 'Would now be flagged' : 'Would no longer be flagged'}: {preview(flip.message)}
          </p>
        ))}
        {flips.length > FLIPS_SHOWN && <p className="text-muted-foreground">and {flips.length - FLIPS_SHOWN} more.</p>}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDiscard}>
          Discard
        </Button>
        <Button size="sm" onClick={() => onUse(suggestion.candidate)}>
          {replacesUnsaved ? 'Replace my unsaved edits' : 'Use as draft'}
        </Button>
      </div>
    </div>
  );
}
