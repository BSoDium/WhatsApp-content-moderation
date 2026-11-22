import { useState } from 'react';
import { Flag, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CORRECTION_LABEL } from '@/lib/activity';
import type { CorrectionKind } from '@/lib/types';

const NOTE_MAX_LENGTH = 500;

const EXPLANATION: Record<CorrectionKind, string> = {
  false_positive: 'The strike this message opened is given back. A deleted message cannot be restored on WhatsApp, and any block stays until you unblock the contact.',
  false_negative: 'Recorded for reviewing moderation accuracy. Nothing is sent to the contact and no strike is added.',
};

interface MarkCorrectionProps {
  kind: CorrectionKind;
  onSubmit: (note: string) => Promise<void>;
}

export function MarkCorrection({ kind, onSubmit }: MarkCorrectionProps) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = CORRECTION_LABEL[kind];

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(note);
      setOpen(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="-my-0.5 shrink-0 text-muted-foreground" aria-label={`Mark as ${label.toLowerCase()}`} title={`Mark as ${label.toLowerCase()}`}>
          <Flag aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <p className="font-medium">Mark as {label.toLowerCase()}</p>
        <p className="text-xs text-muted-foreground">{EXPLANATION[kind]}</p>
        <Input value={note} onChange={(event) => setNote(event.target.value)} maxLength={NOTE_MAX_LENGTH} placeholder="Optional note" aria-label="Note" disabled={submitting} />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
            Mark
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
