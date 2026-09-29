import { ShieldAlert } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

// Stands in for SignedInUser when the app is open to anyone on the network: same footprint, in the warning tone.
export function DirectConnection() {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar size="lg" className="lg:size-9">
        <AvatarFallback className="bg-warning/15 text-warning">
          <ShieldAlert className="size-5" aria-hidden="true" />
        </AvatarFallback>
      </Avatar>
      <span className="hidden min-w-0 text-left leading-tight lg:block">
        <span className="block truncate text-sm font-medium">Direct connection</span>
        <span className="block truncate text-xs font-normal text-warning">Not access-restricted</span>
      </span>
    </span>
  );
}
