import { Skeleton } from '@/components/ui/skeleton';
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
      <span className="hidden min-w-0 text-left leading-tight lg:block">
        <span className="block truncate text-sm font-medium">{user.name}</span>
        {subtitle && <span className="block truncate text-xs font-normal text-muted-foreground">{subtitle}</span>}
      </span>
    </span>
  );
}

export function SignedInUserSkeleton() {
  return (
    <span className="flex min-w-0 items-center gap-2.5 p-1.5 lg:-ml-1.5 lg:pr-3" aria-hidden="true">
      <Skeleton className="size-10 shrink-0 rounded-full lg:size-9" />
      <span className="hidden space-y-1.5 lg:block">
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="h-3 w-40" />
      </span>
    </span>
  );
}
