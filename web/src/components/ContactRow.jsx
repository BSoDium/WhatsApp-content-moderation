import { useState } from 'react';
import { Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { relativeTime } from '@/lib/contact';
import { ContactAvatar } from './ContactAvatar';

export function ContactRow({ contact, monitored, selected, onSelect, onToggle }) {
  const [pending, setPending] = useState(false);
  const label = monitored ? 'Stop moderating this contact' : 'Moderate this contact';

  async function handleToggle(event) {
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
      className={cn('flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-accent', selected && 'bg-accent')}
      onClick={() => onSelect(contact.id)}
    >
      <ContactAvatar contact={contact} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{contact.name}</p>
        <p className="truncate text-sm text-muted-foreground">{relativeTime(contact.lastMessageAt)}</p>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={monitored ? 'default' : 'outline'}
            size="icon"
            aria-label={label}
            aria-pressed={monitored}
            disabled={pending}
            onClick={handleToggle}
          >
            <Ban />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </li>
  );
}
