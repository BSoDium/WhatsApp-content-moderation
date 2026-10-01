import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface BlockStatusProps {
  blocked: boolean;
  contactName: string;
  onUnblock: () => Promise<void>;
  className?: string;
}

/**
 * "Not blocked" as plain text, swapped for a destructive "Unblock" button
 * while the contact is blocked. There is no manual block action: blocks only
 * ever come from strikes.
 */
export function BlockStatus({ blocked, contactName, onUnblock, className }: BlockStatusProps) {
  const [pending, setPending] = useState(false);

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
    <div className={cn('items-center', className)}>
      {blocked ? (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Unblock ${contactName}`}
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
