import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { colorFor, initialsFor } from '@/lib/contact';
import type { SignedInUser as SignedInUserData } from '@/lib/types';

interface SignedInUserProps {
  user: SignedInUserData;
}

export function SignedInUser({ user }: SignedInUserProps) {
  const subtitle = user.tailnet ?? (user.name !== user.login ? user.login : null);

  return (
    <div className="flex min-w-0 items-center gap-2.5" title={[user.name, subtitle].filter(Boolean).join(' · ')}>
      <Avatar size="lg" className="lg:size-9">
        {user.pictureUrl && <AvatarImage src={user.pictureUrl} alt="" referrerPolicy="no-referrer" />}
        <AvatarFallback style={{ backgroundColor: colorFor(user.login), color: '#fff' }}>{initialsFor(user.name)}</AvatarFallback>
      </Avatar>
      <div className="hidden min-w-0 leading-tight lg:block lg:@max-[40rem]:hidden">
        <p className="truncate text-sm font-medium">{user.name}</p>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  );
}
