import { Badge } from '@/components/ui/badge';
import { correctionLabel } from '@/lib/activity';
import type { Correction } from '@/lib/types';

function describe({ kind, note, strikeReverted }: Correction): string {
  const parts = [`Labelled ${correctionLabel(kind).toLowerCase()}`];
  if (strikeReverted) parts.push('strike given back');
  if (note) parts.push(note);
  return parts.join(' — ');
}

export function CorrectionBadge({ correction }: { correction: Correction }) {
  return (
    <Badge variant="outline" className="max-w-full shrink" title={describe(correction)}>
      <span className="truncate">Labelled: {correctionLabel(correction.kind).toLowerCase()}</span>
    </Badge>
  );
}
