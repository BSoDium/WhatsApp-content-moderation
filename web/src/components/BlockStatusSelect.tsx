import { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const BLOCKED = 'blocked';
const NOT_BLOCKED = 'not-blocked';

interface BlockStatusSelectProps {
  blocked: boolean;
  contactName: string;
  onUnblock: () => Promise<void>;
  className?: string;
}

/**
 * Block status that reads as plain text until hovered or focused. Picking
 * "Not blocked" lifts an active block; the other direction doesn't exist
 * because blocks only ever come from strikes, so an unblocked contact's
 * status is inert text.
 */
export function BlockStatusSelect({ blocked, contactName, onUnblock, className }: BlockStatusSelectProps) {
  const [pending, setPending] = useState(false);

  async function handleChange(next: string): Promise<void> {
    if (next !== NOT_BLOCKED) return;
    setPending(true);
    try {
      await onUnblock();
    } finally {
      setPending(false);
    }
  }

  return (
    <Select value={blocked ? BLOCKED : NOT_BLOCKED} onValueChange={handleChange} disabled={!blocked || pending}>
      <SelectTrigger
        size="sm"
        aria-label={`Block status for ${contactName}`}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          '-ml-2 border-transparent px-2 text-xs text-muted-foreground shadow-none hover:bg-muted data-[state=open]:bg-muted dark:bg-transparent dark:hover:bg-muted/50 dark:data-[state=open]:bg-muted/50',
          '[&>svg]:opacity-0 hover:[&>svg]:opacity-100 focus-visible:[&>svg]:opacity-100 data-[state=open]:[&>svg]:opacity-100 disabled:[&>svg]:hidden disabled:opacity-100',
          blocked && 'font-medium text-destructive',
          className,
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start" onClick={(event) => event.stopPropagation()}>
        <SelectItem value={BLOCKED}>Blocked</SelectItem>
        <SelectItem value={NOT_BLOCKED}>Not blocked</SelectItem>
      </SelectContent>
    </Select>
  );
}
