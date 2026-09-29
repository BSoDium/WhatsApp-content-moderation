import { memo, useState } from 'react';
import { History, ShieldCheck, ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { relativeTime } from '@/lib/contact';
import { ContactAvatar } from './ContactAvatar';
import type { Contact, RosterEntry } from '@/lib/types';

interface ContactRowProps {
  contact: Contact;
  monitored: boolean;
  entry: RosterEntry | undefined;
  selected: boolean;
  onSelect: (contactId: string) => void;
  onToggle: (contactId: string, monitored: boolean) => Promise<void>;
  onViewHistory: (contactId: string) => void;
}

const ROW_LAYOUT = 'flex items-center gap-3 rounded-xl px-3 py-2';
const STAT_COLUMN = 'hidden w-20 shrink-0 @lg:block';
const SELF_NAME_COLOR = 'text-emerald-600 dark:text-emerald-400';

// Memoized so a keystroke in the search box, which re-renders ContactList, doesn't re-render every row.
export const ContactRow = memo(function ContactRow({ contact, monitored, entry, selected, onSelect, onToggle, onViewHistory }: ContactRowProps) {
  const [pending, setPending] = useState(false);
  // Only blocks turning it ON: an already-monitored self (TEST_ALLOW_SELF turned back off) must stay switch-off-able.
  const selfBlocked = contact.isSelf && !contact.allowSelf && !monitored;
  const label = selfBlocked ? "You can't moderate your own account" : monitored ? 'Stop moderating this contact' : 'Moderate this contact';
  const strikeCount = entry?.strikeCount ?? contact.strikeCount ?? 0;
  const block = entry ? entry.block : contact.block ?? null;
  const strikeLabel = `${strikeCount} ${strikeCount === 1 ? 'strike' : 'strikes'}`;
  const blockLabel = block ? 'Blocked' : 'Not blocked';

  async function handleToggle(event: React.MouseEvent<HTMLButtonElement>): Promise<void> {
    event.stopPropagation();
    setPending(true);
    try {
      await onToggle(contact.id, !monitored);
    } finally {
      setPending(false);
    }
  }

  return (
    <li
      className={cn(ROW_LAYOUT, 'group cursor-pointer hover:bg-accent', selected && 'bg-accent')}
      onClick={() => onSelect(contact.id)}
    >
      <ContactAvatar contact={contact} />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-baseline gap-1.5 font-medium">
          <span className={cn('truncate', contact.isSelf && SELF_NAME_COLOR)}>{contact.name}</span>
          {contact.isSelf && <span className="shrink-0 font-normal text-muted-foreground">(You)</span>}
        </p>
        <p className="truncate text-xs text-muted-foreground">{relativeTime(contact.lastMessageAt)}</p>
      </div>
      <p className={cn(STAT_COLUMN, 'truncate text-xs text-muted-foreground')} title={strikeLabel}>
        {strikeLabel}
      </p>
      <p className={cn(STAT_COLUMN, 'truncate text-xs text-muted-foreground', block && 'font-medium text-foreground')} title={blockLabel}>
        {blockLabel}
      </p>
      <div className="flex shrink-0 items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-lg"
              className={cn('[@media(hover:hover)]:opacity-0 group-focus-within:opacity-100! group-hover:opacity-100! focus-visible:opacity-100!', selected && 'opacity-100!')}
              aria-label={`View message history for ${contact.name}`}
              onClick={(event) => {
                event.stopPropagation();
                onViewHistory(contact.id);
              }}
            >
              <History />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Message history</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={monitored ? 'default' : 'outline'}
              size="icon-lg"
              aria-label={label}
              aria-pressed={monitored}
              disabled={pending || selfBlocked}
              onClick={handleToggle}
            >
              {monitored ? <ShieldCheck /> : <ShieldOff />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      </div>
    </li>
  );
});

export function ContactRowSkeleton() {
  return (
    <li className={ROW_LAYOUT} aria-hidden="true">
      <Skeleton className="size-8 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-44 max-w-full" />
      </div>
      <Skeleton className={cn(STAT_COLUMN, 'h-3')} />
      <Skeleton className={cn(STAT_COLUMN, 'h-3')} />
      <Skeleton className="size-10 shrink-0 rounded-lg" />
    </li>
  );
}
