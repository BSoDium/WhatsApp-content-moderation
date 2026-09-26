import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { colorFor, initialsFor } from '@/lib/contact';
import type { Contact } from '@/lib/types';

// Its own component so a later real-photo feature only has to add an
// AvatarImage src here, without touching row/panel markup elsewhere.
interface ContactAvatarProps {
  contact: Contact;
  size?: 'sm' | 'default' | 'lg';
  className?: string;
}

export function ContactAvatar({ contact, size, className }: ContactAvatarProps) {
  return (
    <Avatar size={size} className={className}>
      <AvatarFallback style={{ backgroundColor: colorFor(contact.id), color: '#fff' }}>{initialsFor(contact.name)}</AvatarFallback>
    </Avatar>
  );
}
