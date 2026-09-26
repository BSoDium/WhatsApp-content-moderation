import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { colorFor, initialsFor } from '@/lib/contact';

// Its own component so a later real-photo feature only has to add an
// AvatarImage src here, without touching row/panel markup elsewhere.
export function ContactAvatar({ contact, size, className }) {
  return (
    <Avatar size={size} className={className}>
      <AvatarFallback style={{ backgroundColor: colorFor(contact.id), color: '#fff' }}>{initialsFor(contact.name)}</AvatarFallback>
    </Avatar>
  );
}
