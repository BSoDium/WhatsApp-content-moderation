import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatTimestamp } from '@/lib/activity';
import { cn } from '@/lib/utils';

interface BlockStatusProps {
  // Null when the contact isn't blocked; otherwise when the block is due to end.
  blockedUntil: number | null;
  contactName: string;
  onUnblock: () => Promise<void>;
}

/**
 * "Not blocked" as plain text, swapped for a destructive "Unblock" button
 * while the contact is blocked. There is no manual block action: blocks only
 * ever come from strikes. The button stays visible on narrow layouts, where
 * the plain-text status is hidden to save room.
 */
export function BlockStatus({ blockedUntil, contactName, onUnblock }: BlockStatusProps) {
  const [pending, setPending] = useState(false);
  const blocked = blockedUntil !== null;
  const blockedLabel = blocked ? `Blocked until ${formatTimestamp(blockedUntil)}` : '';

  async function handleClick(event: React.MouseEvent<HTMLButtonElement>): Promise<void> {
    event.stopPropagation();
    setPending(true);
    try {
      await onUnblock();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={cn('w-20 shrink-0 items-center justify-center @lg:ml-3 @lg:flex', blocked ? 'flex' : 'hidden')}>
      {blocked ? (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Unblock ${contactName} (${blockedLabel.toLowerCase()})`}
          title={blockedLabel}
          disabled={pending}
          onClick={handleClick}
          className="w-full cursor-pointer text-xs font-medium text-destructive hover:bg-destructive/10 hover:text-destructive active:bg-destructive/20 focus-visible:bg-destructive/10 dark:hover:bg-destructive/20 dark:active:bg-destructive/30 dark:focus-visible:bg-destructive/20"
        >
          Unblock
        </Button>
      ) : (
        <span className="truncate text-xs text-muted-foreground">Not blocked</span>
      )}
    </div>
  );
}
