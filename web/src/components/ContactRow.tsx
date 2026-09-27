import { useState } from 'react';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { relativeTime } from '@/lib/contact';
import { ContactAvatar } from './ContactAvatar';
import type { Contact } from '@/lib/types';

interface ContactRowProps {
  contact: Contact;
  monitored: boolean;
  selected: boolean;
  onSelect: (contactId: string) => void;
  onToggle: (contactId: string, monitored: boolean) => Promise<void>;
}

export function ContactRow({ contact, monitored, selected, onSelect, onToggle }: ContactRowProps) {
  const [pending, setPending] = useState(false);
  const selfLocked = contact.isSelf && !contact.allowSelf;
  const label = selfLocked ? "You can't moderate your own account" : monitored ? 'Stop moderating this contact' : 'Moderate this contact';

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
            disabled={pending || selfLocked}
            onClick={handleToggle}
          >
            {monitored ? <ShieldCheck /> : <ShieldOff />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </li>
  );
}
