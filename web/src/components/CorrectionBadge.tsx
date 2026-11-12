import { Badge } from '@/components/ui/badge';
import { CORRECTION_LABEL } from '@/lib/activity';
import type { Correction } from '@/lib/types';

function describe({ kind, note, strikeReverted }: Correction): string {
  const parts = [CORRECTION_LABEL[kind]];
  if (strikeReverted) parts.push('strike given back');
  if (note) parts.push(note);
  return parts.join(' — ');
}

export function CorrectionBadge({ correction }: { correction: Correction }) {
  return (
    <Badge variant="outline" className="max-w-full shrink" title={describe(correction)}>
      <span className="truncate">Marked: {CORRECTION_LABEL[correction.kind].toLowerCase()}</span>
    </Badge>
  );
}
