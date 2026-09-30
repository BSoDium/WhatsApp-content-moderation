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
      className="inline-flex items-center gap-2 tabular-nums"
    >
      <Icon className="size-3.5" aria-hidden="true" />
      <span>
        <span className={cn(count > 0 && 'font-medium text-foreground', atLimit && 'text-destructive')}>{count}</span>/{limit}
      </span>
    </span>
  );
}
