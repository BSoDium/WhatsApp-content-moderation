import { Badge } from '@/components/ui/badge';
import { actionMeta } from '@/lib/activity';
import type { AuditAction } from '@/lib/types';

export function ActionBadge({ action }: { action: AuditAction }) {
  const meta = actionMeta(action);
  return <Badge variant={meta.badgeVariant}>{meta.label}</Badge>;
}
