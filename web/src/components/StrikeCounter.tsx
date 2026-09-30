import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StrikeCounterProps {
  icon: LucideIcon;
  label: string;
  count: number;
  limit: number;
}

export function StrikeCounter({ icon: Icon, label, count, limit }: StrikeCounterProps) {
  const atLimit = count >= limit;
  return (
    <span
      role="img"
      aria-label={`${label}: ${count} of ${limit}`}
      className={cn('inline-flex items-center gap-1 tabular-nums', count > 0 && 'font-medium text-foreground', atLimit && 'text-destructive')}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {count}/{limit}
    </span>
  );
}
