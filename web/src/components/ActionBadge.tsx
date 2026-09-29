import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { actionMeta } from '@/lib/activity';
import type { AuditAction } from '@/lib/types';

export function ActionBadge({ action, flagged }: { action: AuditAction; flagged?: boolean | null }) {
  const meta = actionMeta(action, flagged);
  return (
    <Badge variant={meta.badgeVariant} className={cn('max-w-full shrink', meta.className)} title={meta.description ? `${meta.label} — ${meta.description}` : meta.label}>
      <span className="truncate">{meta.label}</span>
    </Badge>
  );
}
