import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import type { StatTileDef } from '@/lib/statTiles';

interface StatTileProps {
  def: StatTileDef;
  value: number;
}

const ICON_COLOR = 'text-[color-mix(in_oklab,var(--muted-foreground)_40%,var(--card))]';

export function StatTile({ def, value }: StatTileProps) {
  const Icon = def.icon;
  const empty = value === 0;
  const warn = def.warnWhenNonZero && !empty;

  return (
    <div className="relative flex min-h-32 flex-col items-start justify-end overflow-hidden rounded-xl border border-border bg-card px-4 py-3 text-left">
      <Icon className={cn('absolute top-3 right-3 size-6', ICON_COLOR)} strokeWidth={2.5} aria-hidden="true" />
      <dd className={cn('order-1 text-4xl leading-none font-bold tracking-tight tabular-nums', empty && 'text-muted-foreground/40', warn && 'text-destructive')}>{value}</dd>
      <dt className="order-2 mt-1 text-sm leading-tight font-medium text-muted-foreground">{def.label}</dt>
    </div>
  );
}

export function StatTileSkeleton() {
  return (
    <div className="relative flex min-h-32 flex-col items-start justify-end overflow-hidden rounded-xl border border-border bg-card px-4 py-3" aria-hidden="true">
      <Skeleton className="absolute top-3 right-3 size-6" />
      <Skeleton className="h-9 w-14" />
      <Skeleton className="mt-2 h-4 w-20" />
    </div>
  );
}
