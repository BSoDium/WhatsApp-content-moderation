import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { colorFor, initialsFor } from '@/lib/contact';
import type { SignedInUser as SignedInUserData } from '@/lib/types';

interface SignedInUserProps {
  user: SignedInUserData;
}

export function SignedInUser({ user }: SignedInUserProps) {
  const subtitle = user.tailnet ?? (user.name !== user.login ? user.login : null);

  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar size="lg" className="lg:size-9">
        {user.pictureUrl && <AvatarImage src={user.pictureUrl} alt="" referrerPolicy="no-referrer" />}
        <AvatarFallback style={{ backgroundColor: colorFor(user.login), color: '#fff' }}>{initialsFor(user.name)}</AvatarFallback>
      </Avatar>
      <span className="hidden min-w-0 text-left leading-tight lg:block lg:@max-[40rem]:hidden">
        <span className="block truncate text-sm font-medium">{user.name}</span>
        {subtitle && <span className="block truncate text-xs font-normal text-muted-foreground">{subtitle}</span>}
      </span>
    </span>
  );
}
