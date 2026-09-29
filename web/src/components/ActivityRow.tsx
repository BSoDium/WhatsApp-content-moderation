import { useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { TableCell, TableRow } from '@/components/ui/table';
import { ActionBadge } from './ActionBadge';
import { formatCategory, formatTimestamp } from '@/lib/activity';
import { useIsTruncated } from '@/lib/useIsTruncated';
import type { AuditLogEntry } from '@/lib/types';

// Keyed to the table's own width, not the viewport: the sheet is resizable, so a wide screen can still host a narrow table.
export const WIDE_COLUMNS_SHOWN = '@[44rem]:table-cell';
export const WIDE_COLUMNS_HIDDEN = '@[44rem]:hidden';

export function ActivityRow({ entry }: { entry: AuditLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const truncated = useIsTruncated(contentRef, !expanded);
  const clip = !expanded;

  return (
    <TableRow>
      <TableCell className={cn('hidden truncate px-4 text-xs text-muted-foreground', WIDE_COLUMNS_SHOWN)} title={formatTimestamp(entry.createdAt)}>
        {formatTimestamp(entry.createdAt)}
      </TableCell>
      <TableCell className={cn('hidden truncate px-4', WIDE_COLUMNS_SHOWN)} title={entry.contactName}>
        {entry.contactName}
      </TableCell>
      <TableCell className="overflow-hidden px-4">
        <ActionBadge action={entry.action} flagged={entry.flagged} />
      </TableCell>
      <TableCell className="min-w-0 overflow-hidden px-4 whitespace-normal">
        <div ref={contentRef} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p data-truncatable={clip || undefined} className={cn('text-xs text-muted-foreground', WIDE_COLUMNS_HIDDEN, clip && 'truncate')}>
              {entry.contactName} · {formatTimestamp(entry.createdAt)}
            </p>
            <p data-truncatable={clip || undefined} className={cn('break-words', clip ? 'line-clamp-2' : 'whitespace-pre-line')}>
              {entry.message}
            </p>
            {entry.reason && (
              <p data-truncatable={clip || undefined} className={cn('mt-0.5 text-xs text-muted-foreground', clip && 'truncate')} title={clip ? entry.reason : undefined}>
                {entry.category && entry.category !== 'none' ? `${formatCategory(entry.category)} — ` : ''}
                {entry.reason}
              </p>
            )}
            {entry.error && (
              <p data-truncatable={clip || undefined} className={cn('mt-0.5 text-xs text-destructive', clip && 'truncate')}>
                {entry.error}
              </p>
            )}
          </div>
          {(truncated || expanded) && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="-my-0.5 -mr-2 shrink-0 text-muted-foreground"
              aria-expanded={expanded}
              aria-label={expanded ? 'Show less' : 'Show full message'}
              onClick={() => setExpanded((prev) => !prev)}
            >
              <ChevronDown className={cn('transition-transform duration-200', expanded && 'rotate-180')} aria-hidden="true" />
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
