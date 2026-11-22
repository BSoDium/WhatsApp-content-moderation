import { useState } from 'react';
import { Flag, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { CorrectionOption } from '@/lib/activity';
import type { CorrectionKind } from '@/lib/types';

const NOTE_MAX_LENGTH = 500;

interface MarkCorrectionProps {
  options: CorrectionOption[];
  onSubmit: (kind: CorrectionKind, note: string) => Promise<void>;
}

export function MarkCorrection({ options, onSubmit }: MarkCorrectionProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<CorrectionOption | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(selected.kind, note);
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
        <Button variant="ghost" size="icon-sm" className="-my-0.5 shrink-0 text-muted-foreground" aria-label="Label this message" title="Label this message">
          <Flag aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <p className="font-medium">Is this message acceptable?</p>
        <div role="radiogroup" aria-label="Verdict" className="grid grid-cols-2 gap-2">
          {options.map((option) => (
            <Button
              key={option.kind}
              type="button"
              role="radio"
              aria-checked={selected?.kind === option.kind}
              variant={selected?.kind === option.kind ? 'default' : 'outline'}
              size="sm"
              className={cn('h-auto flex-col gap-0.5 py-1.5')}
              disabled={submitting}
              onClick={() => setSelected(option)}
            >
              <span>{option.label}</span>
              <span className="text-xs font-normal opacity-80">{option.kind.startsWith('confirmed') ? 'classifier was right' : 'classifier was wrong'}</span>
            </Button>
          ))}
        </div>
        <p className="min-h-10 text-xs text-muted-foreground">{selected ? selected.explanation : 'Your labels are used to suggest rules, and a false positive gives the strike back.'}</p>
        <Input value={note} onChange={(event) => setNote(event.target.value)} maxLength={NOTE_MAX_LENGTH} placeholder="Optional note, e.g. why" aria-label="Note" disabled={submitting} />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={!selected || submitting}>
            {submitting && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
            Save label
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
