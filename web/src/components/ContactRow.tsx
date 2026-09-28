import { useState } from 'react';
import { History, ShieldCheck, ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
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

export function ContactRow({ contact, monitored, entry, selected, onSelect, onToggle, onViewHistory }: ContactRowProps) {
  const [pending, setPending] = useState(false);
  // Only blocks turning it ON: an already-monitored self (TEST_ALLOW_SELF turned back off) must stay switch-off-able.
  const selfBlocked = contact.isSelf && !contact.allowSelf && !monitored;
  const label = selfBlocked ? "You can't moderate your own account" : monitored ? 'Stop moderating this contact' : 'Moderate this contact';
  const strikeCount = entry?.strikeCount ?? contact.strikeCount ?? 0;
  const block = entry ? entry.block : contact.block ?? null;

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
      className={cn('group flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 hover:bg-accent', selected && 'bg-accent')}
      onClick={() => onSelect(contact.id)}
    >
      <ContactAvatar contact={contact} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{contact.name}</p>
        <div className="flex min-w-0 items-center gap-x-2 overflow-hidden whitespace-nowrap text-xs text-muted-foreground">
          <span className="min-w-0 truncate">{relativeTime(contact.lastMessageAt)}</span>
          <span className="hidden shrink-0 items-center gap-x-2 @lg:flex">
            <Separator orientation="vertical" className="h-3.5 bg-muted-foreground/50" />
            {strikeCount} {strikeCount === 1 ? 'strike' : 'strikes'}
          </span>
          <span className="hidden shrink-0 items-center gap-x-2 @lg:flex">
            <Separator orientation="vertical" className="h-3.5 bg-muted-foreground/50" />
            {block ? 'Blocked' : 'Not blocked'}
          </span>
        </div>
      </div>
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
}
