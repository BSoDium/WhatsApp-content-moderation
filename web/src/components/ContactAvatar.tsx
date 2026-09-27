import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { colorFor, initialsFor } from '@/lib/contact';
import type { Contact } from '@/lib/types';

// Its own component so row/panel markup elsewhere never has to know whether
// a contact has a real photo. Radix only swaps AvatarImage in once the image
// has actually loaded, so a 404 (no photo, or a failed lookup) or a broken
// image just leaves the initials fallback in place.
interface ContactAvatarProps {
  contact: Contact;
  size?: 'sm' | 'default' | 'lg';
  className?: string;
}

export function ContactAvatar({ contact, size, className }: ContactAvatarProps) {
  return (
    <Avatar size={size} className={className}>
      {contact.photoUrl && <AvatarImage src={contact.photoUrl} alt="" />}
      <AvatarFallback style={{ backgroundColor: colorFor(contact.id), color: '#fff' }}>{initialsFor(contact.name)}</AvatarFallback>
    </Avatar>
  );
}
